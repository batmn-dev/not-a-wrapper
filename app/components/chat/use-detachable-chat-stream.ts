import type { UIMessage } from "@ai-sdk/react"
import { Chat } from "@ai-sdk/react"
import type { ChatTurnBodyFields } from "@/lib/chat-messages/chat-turn-contract"
import {
  consumeLocallyResolvedApprovals,
  restoreLocallyResolvedApprovals,
} from "@/lib/chat-runs/approval-auto-send-gate"
import { LOCAL_CHAT_ID_PREFIX } from "@/lib/chat-store/identity"
import { markChatPerf } from "@/lib/observability/chat-performance"
import { takeChatPerfHeader } from "@/lib/observability/chat-performance-client"
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type ChatTransport,
} from "ai"
import { useCallback, useLayoutEffect, useState } from "react"

export type ChatStreamFinishEvent = {
  message: UIMessage
  isAbort: boolean
  isDisconnect: boolean
  isError: boolean
  finishReason?: string
}

export type ChatStreamHandlers = {
  onAttachedFinish: (event: ChatStreamFinishEvent) => void | Promise<void>
  onDetachedFinish: (
    originChatId: string | null,
    event: ChatStreamFinishEvent
  ) => void | Promise<void>
  onAttachedError: (error: Error) => void
  onDetachedError: (originChatId: string | null, error: Error) => void
}

type SendMessage = Chat<UIMessage>["sendMessage"]
type SendMessageArgs = Parameters<SendMessage>

type StreamBinding = {
  chat: Chat<UIMessage>
}

type AttachedLifecycle = {
  state: "attached"
  ownerChatId: string | null
  finished: boolean
}

type DetachedLifecycle = {
  state: "detached"
  originChatId: string | null
  watchdog: ReturnType<typeof setTimeout> | null
}

type BindingLifecycle = AttachedLifecycle | DetachedLifecycle

type AcceptanceWaiter = {
  resolve: () => void
  reject: (error: unknown) => void
}

class RequestAcceptanceRegistry {
  private readonly waiters = new Map<string, AcceptanceWaiter>()

  wait(messageId: string): Promise<void> {
    if (this.waiters.has(messageId)) {
      throw new Error(`Request acceptance is already pending for ${messageId}`)
    }

    return new Promise<void>((resolve, reject) => {
      this.waiters.set(messageId, { resolve, reject })
    })
  }

  accept(messageId: string | undefined): void {
    if (!messageId) return
    const waiter = this.waiters.get(messageId)
    if (!waiter) return
    this.waiters.delete(messageId)
    waiter.resolve()
  }

  reject(messageId: string | undefined, error: unknown): void {
    if (!messageId) return
    const waiter = this.waiters.get(messageId)
    if (!waiter) return
    this.waiters.delete(messageId)
    waiter.reject(error)
  }
}

class AcceptanceAwareChatTransport extends DefaultChatTransport<UIMessage> {
  constructor(
    private readonly acceptances: RequestAcceptanceRegistry,
    api: string,
    // The closed Chat turn wire contract shape — assembled by the controller's
    // buildChatTurnRequestBody, never an open record: the compile-time link to
    // ChatTurnBodyFields is what keeps a new wire field a contract change.
    private readonly getFallbackTurnBody: () => ChatTurnBodyFields | null
  ) {
    // One-shot chat-perf correlation header (PR 0b): resolves to an empty
    // object unless instrumentation is enabled AND a turn armed an id — so a
    // continuation request never reuses a prior turn's correlation id.
    super({ api, headers: () => takeChatPerfHeader() })
  }

  override async sendMessages(
    options: Parameters<ChatTransport<UIMessage>["sendMessages"]>[0]
  ) {
    // SDK-initiated dispatches (the approval-continuation auto-send) carry no
    // per-call body — only the turn runners pass one. The wire contract
    // requires chatId/model on every POST, so a body without a chatId merges
    // the mounted chat's turn fields UNDER any per-call values. Runner sends
    // always carry chatId and are never touched.
    const callBody = options.body as Record<string, unknown> | undefined
    const fallbackBody =
      typeof callBody?.chatId === "string" ? null : this.getFallbackTurnBody()
    const dispatchOptions = fallbackBody
      ? { ...options, body: { ...fallbackBody, ...(callBody ?? {}) } }
      : options
    try {
      // HttpChatTransport resolves here only after fetch returned an OK
      // response with a body. The route performs durable prepareGeneration —
      // including the idempotent first-message claim — before constructing
      // that response, so this is the request-acceptance boundary. The stream
      // itself remains unconsumed and can continue independently.
      const stream = await super.sendMessages(dispatchOptions)
      this.acceptances.accept(options.messageId)
      return stream
    } catch (error) {
      this.acceptances.reject(options.messageId, error)
      throw error
    }
  }
}

type DetachableChatStreamOwner = {
  createBinding: (
    messages: UIMessage[],
    ownerChatId: string | null
  ) => StreamBinding
  detach: (binding: StreamBinding) => void
  adopt: (binding: StreamBinding, chatId: string) => void
  readopt: (chatId: string) => StreamBinding | null
  setHandlers: (handlers: ChatStreamHandlers) => void
  setFallbackTurnBodyProvider: (
    provider: (() => ChatTurnBodyFields | null) | null
  ) => void
  dispatchMessageAndWaitForAcceptance: (
    sendMessage: SendMessage,
    ...args: SendMessageArgs
  ) => Promise<void>
}

/**
 * Detached-binding gauges (PR 0b step 7): enumerable counts beside the
 * WeakMap lifecycle (which is deliberately non-enumerable). Counts and class
 * enums only — no chat ids or content ever leave through these marks, and
 * emission is a no-op unless client instrumentation is enabled.
 */
let attachedBindingCount = 0
let detachedBindingCount = 0

function classifyBindingChat(
  chatId: string | null
): "durable" | "guest" | "unowned" {
  if (chatId === null) return "unowned"
  return chatId.startsWith(LOCAL_CHAT_ID_PREFIX) ? "guest" : "durable"
}

function emitBindingGauge(
  event:
    | "created"
    | "detached"
    | "adopted"
    | "readopted"
    | "finished_attached"
    | "finished_detached"
    | "watchdog_stop",
  chatId: string | null
) {
  markChatPerf("detached_binding_gauge", {
    event,
    attachedCount: attachedBindingCount,
    detachedCount: detachedBindingCount,
    bindingClass: classifyBindingChat(chatId),
  })
}

function createDetachableChatStreamOwner(
  streamTimeoutMs: number,
  api: string
): DetachableChatStreamOwner {
  const lifecycles = new WeakMap<StreamBinding, BindingLifecycle>()
  // Still-live detached bindings by origin chat id, so a mounted transition
  // BACK to a generating chat can re-adopt the word-granular stream instead
  // of rendering the 750 ms durable snapshots (the nav-return chunking of
  // docs/measurements/2026-07-28-streaming-failures-investigation.md §Issue 2).
  // At most one entry per chat id can exist: a chat's next binding is only
  // created when no live detached binding was available to re-adopt. Entries
  // are removed on re-adoption or by routeFinish — the SDK invokes onFinish
  // in a `finally`, so every stream (complete, error, abort, watchdog stop)
  // deregisters and the map cannot leak a dead binding.
  const detachedByOrigin = new Map<string, StreamBinding>()
  const acceptances = new RequestAcceptanceRegistry()
  let fallbackTurnBodyProvider: (() => ChatTurnBodyFields | null) | null =
    null
  const transport = new AcceptanceAwareChatTransport(acceptances, api, () =>
    fallbackTurnBodyProvider ? fallbackTurnBodyProvider() : null
  )
  let handlers: ChatStreamHandlers | null = null

  const clearWatchdog = (binding: StreamBinding) => {
    const lifecycle = lifecycles.get(binding)
    if (lifecycle?.state !== "detached" || lifecycle.watchdog === null) return
    clearTimeout(lifecycle.watchdog)
    lifecycle.watchdog = null
  }

  // Re-adoptable means the binding's request is still in flight. Read from
  // the SDK chat (not the lifecycle's `finished` flag, which latches after a
  // binding's FIRST completed turn and says nothing about the current one).
  const isStreamLive = (binding: StreamBinding) => {
    const status = binding.chat.status
    return status === "submitted" || status === "streaming"
  }

  const routeFinish = (
    binding: StreamBinding,
    event: ChatStreamFinishEvent
  ) => {
    const lifecycle = lifecycles.get(binding)
    if (!lifecycle || !handlers) return
    if (lifecycle.state === "detached") {
      clearWatchdog(binding)
      if (
        lifecycle.originChatId !== null &&
        detachedByOrigin.get(lifecycle.originChatId) === binding
      ) {
        detachedByOrigin.delete(lifecycle.originChatId)
      }
      detachedBindingCount = Math.max(0, detachedBindingCount - 1)
      emitBindingGauge("finished_detached", lifecycle.originChatId)
      void handlers.onDetachedFinish(lifecycle.originChatId, event)
      return
    }
    lifecycle.finished = true
    attachedBindingCount = Math.max(0, attachedBindingCount - 1)
    emitBindingGauge("finished_attached", lifecycle.ownerChatId)
    void handlers.onAttachedFinish(event)
  }

  const routeError = (binding: StreamBinding, error: Error) => {
    const lifecycle = lifecycles.get(binding)
    if (!lifecycle || !handlers) return
    if (lifecycle.state === "detached") {
      handlers.onDetachedError(lifecycle.originChatId, error)
      return
    }
    handlers.onAttachedError(error)
  }

  return {
    createBinding(messages, ownerChatId) {
      const binding: StreamBinding = {
        chat: null as unknown as Chat<UIMessage>,
      }
      lifecycles.set(binding, {
        state: "attached",
        ownerChatId,
        finished: false,
      })
      attachedBindingCount += 1
      emitBindingGauge("created", ownerChatId)
      // Ids consumed by the LAST armed auto-send, held until its outcome is
      // known: an errored dispatch restores them (the SDK never re-evaluates
      // its predicate on error, and the approval is already resolved durably
      // — without restoration the continuation would be stranded with no
      // recovery); a finished dispatch discards them, keeping the arm
      // one-shot across remounts.
      let armedContinuationApprovalIds: string[] = []
      binding.chat = new Chat<UIMessage>({
        transport,
        messages,
        sendAutomaticallyWhen: (args) => {
          const lifecycle = lifecycles.get(binding)
          if (lifecycle?.state === "detached") return false
          if (!lastAssistantMessageIsCompleteWithApprovalResponses(args)) {
            return false
          }
          // Only the tab that LOCALLY resolved the approval may auto-send the
          // continuation (gameplan §10 layer 3), and the resolution arms
          // exactly ONE dispatch — consuming here closes the gate for any
          // later remount that rehydrates the same approval-responded parts.
          const lastMessage = args.messages[args.messages.length - 1]
          if (lastMessage === undefined) return false
          const consumed = consumeLocallyResolvedApprovals(lastMessage)
          if (consumed.length === 0) return false
          armedContinuationApprovalIds = consumed
          return true
        },
        onFinish: (event) => {
          armedContinuationApprovalIds = []
          routeFinish(binding, event)
        },
        onError: (error) => {
          if (armedContinuationApprovalIds.length > 0) {
            restoreLocallyResolvedApprovals(armedContinuationApprovalIds)
            armedContinuationApprovalIds = []
          }
          routeError(binding, error)
        },
      })
      return binding
    },

    detach(binding) {
      const lifecycle = lifecycles.get(binding)
      if (!lifecycle || lifecycle.state === "detached") return
      const detached: DetachedLifecycle = {
        state: "detached",
        originChatId: lifecycle.ownerChatId,
        watchdog: null,
      }
      lifecycles.set(binding, detached)
      if (detached.originChatId !== null && isStreamLive(binding)) {
        detachedByOrigin.set(detached.originChatId, binding)
      }
      if (!lifecycle.finished) {
        attachedBindingCount = Math.max(0, attachedBindingCount - 1)
      }
      if (lifecycle.finished) {
        emitBindingGauge("detached", detached.originChatId)
        return
      }
      detachedBindingCount += 1
      emitBindingGauge("detached", detached.originChatId)
      detached.watchdog = setTimeout(() => {
        detached.watchdog = null
        // Count is settled by the stop's own finish routing (routeFinish
        // decrements on finished_detached); this gauge only records the fire.
        emitBindingGauge("watchdog_stop", detached.originChatId)
        binding.chat.stop()
      }, streamTimeoutMs)
    },

    adopt(binding, chatId) {
      const lifecycle = lifecycles.get(binding)
      if (lifecycle?.state === "attached" && lifecycle.ownerChatId === null) {
        lifecycle.ownerChatId = chatId
        emitBindingGauge("adopted", chatId)
      }
    },

    // The inverse of detach, for a mounted transition BACK to a chat whose
    // detached binding is still streaming: the binding returns to attached
    // (identity re-frozen to its origin — which is the destination), its
    // watchdog is cleared (the attached stuck-stream guard owns the budget
    // again), and `sendAutomaticallyWhen` re-arms by construction since it
    // reads the lifecycle at dispatch time. Returns null when no live
    // detached binding exists for the chat — the caller falls through to
    // today's fresh-binding + snapshot-projection path.
    readopt(chatId) {
      const binding = detachedByOrigin.get(chatId)
      if (!binding) return null
      detachedByOrigin.delete(chatId)
      const lifecycle = lifecycles.get(binding)
      // Belt-and-braces: registry maintenance keeps entries live (routeFinish
      // deregisters in the SDK's `finally`), so these guards should never
      // fire — but re-adopting a dead stream would trade the snapshot path
      // for a frozen thread, so verify before flipping ownership.
      if (lifecycle?.state !== "detached" || !isStreamLive(binding)) {
        return null
      }
      clearWatchdog(binding)
      lifecycles.set(binding, {
        state: "attached",
        ownerChatId: chatId,
        finished: false,
      })
      detachedBindingCount = Math.max(0, detachedBindingCount - 1)
      attachedBindingCount += 1
      emitBindingGauge("readopted", chatId)
      return binding
    },

    setHandlers(nextHandlers) {
      handlers = nextHandlers
    },

    setFallbackTurnBodyProvider(provider) {
      fallbackTurnBodyProvider = provider
    },

    async dispatchMessageAndWaitForAcceptance(sendMessage, ...args) {
      const messageId = args[0]?.messageId
      if (!messageId) {
        throw new Error("Accepted chat dispatch requires a messageId")
      }
      const accepted = acceptances.wait(messageId)
      try {
        // AI SDK's promise settles after stream consumption and catches
        // transport failures internally. Observe it only to prevent a
        // pre-transport rejection from becoming unhandled; acceptance itself
        // is resolved by the transport as soon as the HTTP response is valid.
        void Promise.resolve(sendMessage(...args)).catch((error) => {
          acceptances.reject(messageId, error)
        })
      } catch (error) {
        acceptances.reject(messageId, error)
      }
      await accepted
    },
  }
}

export type DetachableChatStream = {
  chat: Chat<UIMessage>
  sendMessageAndWaitForAcceptance: (
    sendMessage: SendMessage,
    ...args: SendMessageArgs
  ) => Promise<void>
  /** Internal commit state shared with useCommitDetachableChatStream. */
  commit: {
    owner: DetachableChatStreamOwner
    chatId: string | null
    binding: StreamBinding
    replace: (chatId: string | null, binding: StreamBinding) => void
  }
}

export function useDetachableChatStream({
  chatId,
  initialMessages,
  streamTimeoutMs,
  api,
  getFallbackTurnBody,
}: {
  chatId: string | null
  initialMessages: UIMessage[]
  streamTimeoutMs: number
  api: string
  /**
   * Turn fields (chatId/model/…) for dispatches the SDK initiates itself —
   * today only the approval-continuation auto-send, which carries no per-call
   * body. Read at dispatch time; null means "no mounted durable chat".
   */
  getFallbackTurnBody?: () => ChatTurnBodyFields | null
}): DetachableChatStream {
  const [owner] = useState(() =>
    createDetachableChatStreamOwner(streamTimeoutMs, api)
  )
  useLayoutEffect(() => {
    owner.setFallbackTurnBodyProvider(getFallbackTurnBody ?? null)
  }, [owner, getFallbackTurnBody])
  const [streamState, setStreamState] = useState(() => ({
    chatId,
    binding: owner.createBinding(initialMessages, chatId),
  }))
  const sendMessageAndWaitForAcceptance = useCallback(
    (sendMessage: SendMessage, ...args: SendMessageArgs) =>
      owner.dispatchMessageAndWaitForAcceptance(sendMessage, ...args),
    [owner]
  )

  return {
    chat: streamState.binding.chat,
    sendMessageAndWaitForAcceptance,
    commit: {
      owner,
      chatId: streamState.chatId,
      binding: streamState.binding,
      replace: (nextChatId, binding) =>
        setStreamState({ chatId: nextChatId, binding }),
    },
  }
}

/**
 * One layout-phase commit owns the complete navigation transition. The old
 * binding is detached and its origin frozen before handlers for the newly
 * visible chat are published. JavaScript cannot interleave a stream callback
 * between those synchronous operations, so callback routing observes either
 * the complete old commit or the complete new one.
 */
export function useCommitDetachableChatStream({
  stream,
  chatId,
  initialMessages,
  handlers,
  onChatTransition,
}: {
  stream: DetachableChatStream
  chatId: string | null
  initialMessages: UIMessage[]
  handlers: ChatStreamHandlers
  onChatTransition: (
    previousChatId: string | null,
    nextChatId: string | null
  ) => void
}): void {
  useLayoutEffect(() => {
    const { owner, chatId: committedChatId, binding } = stream.commit

    if (committedChatId !== chatId) {
      if (committedChatId === null && chatId !== null) {
        // First-turn route adoption keeps the live binding and optimistic
        // messages; only its attached owner identity advances. But when the
        // current binding is idle, this transition can also be a RETURN to a
        // generating chat through the onboarding surface (Back detached its
        // stream, then Forward / a sidebar click re-enters) — re-adopt the
        // destination's live binding then, and discard the idle one exactly
        // like the transition path below discards its predecessor.
        const currentStreamIsLive =
          binding.chat.status === "submitted" ||
          binding.chat.status === "streaming"
        const readopted = currentStreamIsLive ? null : owner.readopt(chatId)
        if (readopted) {
          owner.detach(binding)
          stream.commit.replace(chatId, readopted)
        } else {
          owner.adopt(binding, chatId)
          stream.commit.replace(chatId, binding)
        }
      } else {
        // Freeze the previous origin before the new callback router becomes
        // observable. If the DESTINATION chat's own detached binding is still
        // streaming (the user navigated away mid-generation and came back),
        // re-adopt it so the surface resumes the word-granular local stream —
        // its Chat holds the full canonical array for the origin chat,
        // strictly fresher than the 750 ms durable snapshots. Otherwise
        // prepare a fresh attached binding for the route; Convex remains the
        // recovery plane for reload/second-tab/other-device.
        owner.detach(binding)
        const readopted = chatId === null ? null : owner.readopt(chatId)
        const nextBinding =
          readopted ?? owner.createBinding(initialMessages, chatId)
        stream.commit.replace(chatId, nextBinding)
      }
      onChatTransition(committedChatId, chatId)
    }

    owner.setHandlers(handlers)
  })
}
