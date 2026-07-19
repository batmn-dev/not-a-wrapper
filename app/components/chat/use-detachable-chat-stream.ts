import type { UIMessage } from "@ai-sdk/react"
import { Chat } from "@ai-sdk/react"
import { consumeLocallyResolvedApprovals } from "@/lib/chat-runs/approval-auto-send-gate"
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
    api: string
  ) {
    super({ api })
  }

  override async sendMessages(
    options: Parameters<ChatTransport<UIMessage>["sendMessages"]>[0]
  ) {
    try {
      // HttpChatTransport resolves here only after fetch returned an OK
      // response with a body. The route performs durable prepareGeneration —
      // including the idempotent first-message claim — before constructing
      // that response, so this is the request-acceptance boundary. The stream
      // itself remains unconsumed and can continue independently.
      const stream = await super.sendMessages(options)
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
  setHandlers: (handlers: ChatStreamHandlers) => void
  dispatchMessageAndWaitForAcceptance: (
    sendMessage: SendMessage,
    ...args: SendMessageArgs
  ) => Promise<void>
}

function createDetachableChatStreamOwner(
  streamTimeoutMs: number,
  api: string
): DetachableChatStreamOwner {
  const lifecycles = new WeakMap<StreamBinding, BindingLifecycle>()
  const acceptances = new RequestAcceptanceRegistry()
  const transport = new AcceptanceAwareChatTransport(acceptances, api)
  let handlers: ChatStreamHandlers | null = null

  const clearWatchdog = (binding: StreamBinding) => {
    const lifecycle = lifecycles.get(binding)
    if (lifecycle?.state !== "detached" || lifecycle.watchdog === null) return
    clearTimeout(lifecycle.watchdog)
    lifecycle.watchdog = null
  }

  const routeFinish = (
    binding: StreamBinding,
    event: ChatStreamFinishEvent
  ) => {
    const lifecycle = lifecycles.get(binding)
    if (!lifecycle || !handlers) return
    if (lifecycle.state === "detached") {
      clearWatchdog(binding)
      void handlers.onDetachedFinish(lifecycle.originChatId, event)
      return
    }
    lifecycle.finished = true
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
          return (
            lastMessage !== undefined &&
            consumeLocallyResolvedApprovals(lastMessage)
          )
        },
        onFinish: (event) => routeFinish(binding, event),
        onError: (error) => routeError(binding, error),
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
      if (lifecycle.finished) return
      detached.watchdog = setTimeout(() => {
        detached.watchdog = null
        binding.chat.stop()
      }, streamTimeoutMs)
    },

    adopt(binding, chatId) {
      const lifecycle = lifecycles.get(binding)
      if (lifecycle?.state === "attached" && lifecycle.ownerChatId === null) {
        lifecycle.ownerChatId = chatId
      }
    },

    setHandlers(nextHandlers) {
      handlers = nextHandlers
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
}: {
  chatId: string | null
  initialMessages: UIMessage[]
  streamTimeoutMs: number
  api: string
}): DetachableChatStream {
  const [owner] = useState(() =>
    createDetachableChatStreamOwner(streamTimeoutMs, api)
  )
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
        // messages; only its attached owner identity advances.
        owner.adopt(binding, chatId)
        stream.commit.replace(chatId, binding)
      } else {
        // Freeze the previous origin before the new callback router becomes
        // observable, then prepare a fresh attached binding for the route.
        owner.detach(binding)
        const nextBinding = owner.createBinding(initialMessages, chatId)
        stream.commit.replace(chatId, nextBinding)
      }
      onChatTransition(committedChatId, chatId)
    }

    owner.setHandlers(handlers)
  })
}
