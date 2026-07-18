import { useChatEdit } from "@/app/components/chat/use-chat-edit"
import { toast } from "@/components/ui/toast"
import { api } from "@/convex/_generated/api"
import { getOrCreateGuestUserId } from "@/lib/api"
import { useChats } from "@/lib/chat-store/chats/provider"
import {
  createOptimisticMessageId,
  getMessagePersistenceMode,
  GUEST_CHAT_STORAGE_KEY,
} from "@/lib/chat-store/identity"
import { projectSelectedPath } from "@/lib/chat-store/turns/selected-path"
import {
  createChatTurnController,
  type ChatTurnMessage,
  type EnsureChatForTurnArgs,
  type EnsuredTurnChat,
  type StagedAttachmentReference,
} from "@/lib/chat-turn/chat-turn-controller"
import { attachStagedFilesToChat } from "@/lib/file-handling"
import { API_ROUTE_CHAT } from "@/lib/routes"
import type { UserProfile } from "@/lib/user/types"
import { isEmptyAssistantMessage } from "@/convex/domain/message_visibility"
import { routePersistsChatMessages } from "@/lib/chat-turn/turn-store"
import type { UIMessage } from "@ai-sdk/react"
import { Chat, useChat } from "@ai-sdk/react"
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai"
import { useConvex, useMutation } from "convex/react"
import { useSearchParams } from "next/navigation"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useTurnContext } from "./turn-context"

/** One send-type Chat turn's inputs, assembled by the Composer. */
export type ChatTurnPayload = {
  text: string
  files: File[]
  attachments: StagedAttachmentReference[]
}

/**
 * One AI SDK Chat instance plus the origin identity its finish-time work
 * routes to. The mounted hook owns exactly one attached binding; a mounted
 * chat-id transition away from a chat replaces it and marks the old binding
 * detached (see the detach comment in `useChatCore`). `ownerChatId` tracks the
 * mounted chat only while the binding is attached, so by detach time it is
 * already frozen at the chat the stream belongs to — finish-time routing never
 * consults current navigation state, which by then identifies a different
 * chat (or none).
 */
type ChatStreamBinding = {
  chat: Chat<UIMessage>
  ownerChatId: string | null
  detached: boolean
  watchdog: ReturnType<typeof setTimeout> | null
}

/** The subset of the AI SDK finish event the finish handlers consume. */
type ChatStreamFinishEvent = {
  message: UIMessage
  isAbort: boolean
  isDisconnect: boolean
  isError: boolean
  finishReason?: string
}

/**
 * Hard time budget for one generation's client stream. Attached streams get it
 * from the stuck-stream guard; detached streams get the same budget from the
 * per-binding watchdog, so an orphaned stream can never run (or spend)
 * unbounded even if server settlement degrades.
 */
const STREAM_TIMEOUT_MS = 120_000

type UseChatCoreProps = {
  initialMessages: UIMessage[]
  /** Cache message locally and persist to Convex. Pass overrideChatId to handle stale closures during chat creation. */
  cacheAndAddMessage: (
    message: UIMessage,
    overrideChatId?: string
  ) => void | Promise<void>
  chatId: string | null
  user: UserProfile | null
  checkLimitsAndNotify: (uid: string) => Promise<boolean>
  ensureChatExists: (
    args: EnsureChatForTurnArgs
  ) => Promise<EnsuredTurnChat | null>
  bumpChat: (chatId: string) => void
  /** Imperative bridge to the Composer's display, for ?prompt= hydration. */
  setComposerText?: (text: string) => void
}

export function useChatCore({
  initialMessages,
  cacheAndAddMessage,
  chatId,
  user,
  checkLimitsAndNotify,
  ensureChatExists,
  bumpChat,
  setComposerText,
}: UseChatCoreProps) {
  // State management
  const [isSubmitting, setIsSubmitting] = useState(false)
  const approveToolCall = useMutation(api.chatRuntime.approveToolCall)
  const denyToolCall = useMutation(api.chatRuntime.denyToolCall)
  const convex = useConvex()

  // The Turn context — model/search/system-prompt inputs read at run time by
  // the turn runners (adapters.getTurnSnapshot), reactive here only where a
  // render depends on them. See CONTEXT.md "Turn context".
  const {
    getTurnSnapshot,
    isAuthenticated,
    systemPrompt,
    isHydrated: turnContextHydrated,
  } = useTurnContext()

  // Mutable guard prevents concurrent sends (state updates are batched and can lag).
  const [isSendingStore] = useState(() => {
    let isSending = false

    return {
      get: () => isSending,
      set: (value: boolean) => {
        isSending = value
      },
    }
  })

  // Deferred edit persistence: stores the edited user message so onFinish can
  // persist it AFTER the stream completes, avoiding provider state mutations
  // during the same React batch as sendMessage/setMessages.
  const [pendingEditStore] = useState(() => {
    let pendingEdit: {
      message: ChatTurnMessage
      chatId: string
    } | null = null

    return {
      stage: (message: ChatTurnMessage, currentChatId: string) => {
        pendingEdit = {
          message,
          chatId: currentChatId,
        }
      },
      get: () => pendingEdit,
      clear: () => {
        pendingEdit = null
      },
    }
  })

  const [hasDialogAuth, setHasDialogAuth] = useState(false)

  // Track the finish reason of the last assistant message.
  // Used to show a truncation indicator when finishReason is "length".
  const [lastFinishReasonState, setLastFinishReasonState] = useState<{
    chatId: string | null
    finishReason: string | undefined
  }>(() => ({
    chatId,
    finishReason: undefined,
  }))
  const lastFinishReason =
    lastFinishReasonState.chatId === chatId
      ? lastFinishReasonState.finishReason
      : undefined

  // State for tracking first message sent (prevents redirect after sending)
  const [sentFirstMessageChatId, setSentFirstMessageChatId] = useState<
    string | null
  >(null)
  const [previousChatIdStore] = useState(() => {
    let previousChatId: string | null = chatId

    return {
      get: () => previousChatId,
      set: (nextChatId: string | null) => {
        previousChatId = nextChatId
      },
    }
  })
  const hasSentFirstMessage =
    chatId !== null && sentFirstMessageChatId === chatId
  const setHasSentFirstMessage = useCallback(
    (hasSent: boolean) => {
      setSentFirstMessageChatId(
        hasSent ? (chatId ?? previousChatIdStore.get()) : null
      )
    },
    [chatId, previousChatIdStore]
  )
  const hydratedChatIdRef = useRef<string | null>(null)
  const setLastFinishReason = useCallback(
    (finishReason: string | undefined) => {
      setLastFinishReasonState({
        chatId: chatId ?? previousChatIdStore.get(),
        finishReason,
      })
    },
    [chatId, previousChatIdStore]
  )

  // Search params handling — ?prompt= hydration and the auto-submit form of a
  // shared prompt link. First turns (home and project surfaces) dispatch
  // through runSendTurn directly and never round-trip through the URL.
  const searchParams = useSearchParams()
  const prompt = searchParams.get("prompt")
  const shouldAutoSubmitPrompt = searchParams.get("autoSubmit") === "1"

  // Chats operations
  const { updateTitle } = useChats()

  // Handle errors directly in onError callback
  const handleError = useCallback((error: Error) => {
    console.error("Chat error:", error)
    console.error("Error message:", error.message)
    let errorMsg = error.message || "Something went wrong."

    if (errorMsg === "An error occurred" || errorMsg === "fetch failed") {
      errorMsg = "Something went wrong. Please try again."
    }

    toast({
      title: errorMsg,
      status: "error",
    })
  }, [])

  // Memoized transport for v6
  const transport = useMemo(
    () => new DefaultChatTransport({ api: API_ROUTE_CHAT }),
    []
  )

  // Mounted chat-id transitions detach — the in-place equivalent of a remount.
  // Leaving a mounted chat (browser Back/Forward over the shallow-pushState
  // first-turn flow, e.g. Back to the onboarding surface mid-generation) means
  // the same thing as link navigation, which remounts Chat and deliberately
  // leaves the durable run streaming: the run normally settles server-side
  // (ADR-0011; a degraded settlement leaves the run for the supersede sweep or
  // the per-binding watchdog below) and the sidebar keeps its backend-projected
  // generating status. Replacing the binding hands useChat a fresh Chat
  // instance in this same render — it starts from this render's
  // `initialMessages` (empty on the onboarding surface, so showOnboarding
  // holds), while the previous instance keeps consuming its stream detached:
  // its deltas never reach the mounted array and no abort is sent. The Stop
  // button, bound to the current instance, stays the only user-facing abort;
  // a durable run-scoped Stop usable after re-entry is deferred alongside
  // ADR-0011's lease/reaper (see docs/adr/0012).
  //
  // null → chatId does NOT detach: first-turn adoption keeps the binding so
  // the optimistic user row and the already-started stream carry into the
  // durable route.
  //
  // The hook owns its Chat instances (useChat's `chat` option) precisely so
  // every stream callback is bound to its own `ChatStreamBinding`: business
  // logic routes through `streamHandlersRef` (always the latest closures), but
  // identity comes from the binding — a detached finish persists to its frozen
  // `ownerChatId`, never to whatever chat the surface shows by then, and a
  // detached binding refuses `sendAutomaticallyWhen` so an orphan can't
  // auto-continue a tool-approval turn.
  const streamHandlersRef = useRef<{
    onFinish: (
      binding: ChatStreamBinding,
      event: ChatStreamFinishEvent
    ) => void | Promise<void>
    onError: (binding: ChatStreamBinding, streamError: Error) => void
  } | null>(null)

  const createStreamBinding = (
    bindingChatId: string | null,
    seedMessages: UIMessage[]
  ): ChatStreamBinding => {
    const binding: ChatStreamBinding = {
      chat: null as unknown as Chat<UIMessage>,
      ownerChatId: bindingChatId,
      detached: false,
      watchdog: null,
    }
    binding.chat = new Chat<UIMessage>({
      transport,
      messages: seedMessages,
      sendAutomaticallyWhen: (args) =>
        binding.detached
          ? false
          : lastAssistantMessageIsCompleteWithApprovalResponses(args),
      onFinish: (event) => {
        void streamHandlersRef.current?.onFinish(binding, event)
      },
      onError: (streamError) => {
        streamHandlersRef.current?.onError(binding, streamError)
      },
    })
    return binding
  }

  const [streamState, setStreamState] = useState(() => ({
    chatId,
    binding: createStreamBinding(chatId, initialMessages),
  }))
  let activeBinding = streamState.binding
  if (streamState.chatId !== chatId) {
    // Adjust-during-render, not an effect: the replacement must land in the
    // same render that drops the chat id, or one frame of the old thread leaks
    // into the onboarding surface. Construction is side-effect-free, so a
    // discarded concurrent render leaves only an unreferenced instance; the
    // detach side effects (freezing ownership, arming the watchdog) run in the
    // commit-side transition effect below. (useChat itself reassigns its
    // internal ref during render when `chat` changes; a discarded render's
    // reassignment self-heals on the next committed render because the
    // committed `streamState` still names the committed instance.)
    const nextBinding =
      streamState.chatId !== null
        ? createStreamBinding(chatId, initialMessages)
        : streamState.binding
    activeBinding = nextBinding
    setStreamState({ chatId, binding: nextBinding })
  }

  const {
    messages,
    sendMessage,
    regenerate,
    status,
    error,
    stop,
    setMessages,
    addToolApprovalResponse,
  } = useChat({ chat: activeBinding.chat })

  const setMessagesRef = useRef(setMessages)
  useEffect(() => {
    setMessagesRef.current = setMessages
  }, [setMessages])

  // Latest live turn array, read by the selected-path projection effect without
  // making it re-run on every streaming delta; and live generation state, read
  // by the edit guard at call time so a stale `submitEdit` closure can't refuse
  // an edit with an outdated status. Synced post-render (refs are not touched
  // during render).
  const messagesRef = useRef(messages)
  const statusRef = useRef(status)
  const isSubmittingRef = useRef(isSubmitting)
  useLayoutEffect(() => {
    messagesRef.current = messages
    statusRef.current = status
    isSubmittingRef.current = isSubmitting
    // Track the mounted chat as this binding's origin while it is attached
    // (covers null → chatId first-turn adoption). A mounted transition away
    // from a chat replaces the binding in the same render, so the replaced
    // binding's ownerChatId is left frozen at the chat it served.
    if (!activeBinding.detached) {
      activeBinding.ownerChatId = chatId
    }
  })
  const getStatus = useCallback(() => statusRef.current, [])
  const getIsSubmitting = useCallback(() => isSubmittingRef.current, [])
  // Call-time read of the live turn array for the edit/regeneration runners.
  // Their plans validate against a specific message's server-adopted state
  // (createdAt cutoff, visible count), and the message rows holding these
  // callbacks are memoized with comparators that ignore callback identity — a
  // render-time `messages` closure goes stale there and dispatches
  // pre-adoption timestamps the server guards reject.
  const getMessages = useCallback(
    () => messagesRef.current as ChatTurnMessage[],
    []
  )

  const updateMessages = useCallback(
    (action: Parameters<typeof setMessages>[0]) => {
      setMessagesRef.current(action)
    },
    []
  )

  const getIsSending = useCallback(() => isSendingStore.get(), [isSendingStore])

  const setIsSending = useCallback(
    (value: boolean) => {
      isSendingStore.set(value)
    },
    [isSendingStore]
  )

  const stagePendingEdit = useCallback(
    (message: ChatTurnMessage, currentChatId: string) => {
      pendingEditStore.stage(message, currentChatId)
    },
    [pendingEditStore]
  )

  const getPendingEdit = useCallback(
    () => pendingEditStore.get(),
    [pendingEditStore]
  )

  const clearPendingEdit = useCallback(() => {
    pendingEditStore.clear()
  }, [pendingEditStore])

  const setPreviousChatId = useCallback(
    (currentChatId: string) => {
      previousChatIdStore.set(currentChatId)
    },
    [previousChatIdStore]
  )

  const chatTurn = createChatTurnController({
    createOptimisticMessageId,
    getTurnSnapshot,
    getIsSending,
    setIsSending,
    setIsSubmitting,
    setHasSentFirstMessage,
    setMessages: (action) => setMessages(action),
    // The controller composes its turn store from these internally — this hook
    // never builds or holds the store.
    store: {
      isAuthenticated: () => isAuthenticated,
      updateMessages,
      cacheAndAddMessage,
      updateTitle,
      pendingEdit: {
        stage: stagePendingEdit,
        get: getPendingEdit,
        clear: clearPendingEdit,
      },
      getStoredGuestChatId: () =>
        typeof window !== "undefined"
          ? localStorage.getItem(GUEST_CHAT_STORAGE_KEY)
          : null,
      reportError: (message, error) => console.error(message, error),
    },
    resolveUserId: () => getOrCreateGuestUserId(user),
    checkLimitsAndNotify,
    ensureChatExists,
    setPreviousChatId,
    cleanupOptimisticAttachments: () => undefined,
    attachStagedFiles: (currentChatId, attachmentIds) =>
      attachStagedFilesToChat(convex, currentChatId, attachmentIds),
    sendMessage,
    regenerate,
    toastError: (title) => toast({ title, status: "error" }),
    bumpChat,
    setLastFinishReason,
    reportError: (message, error) => console.error(message, error),
  })

  // Finish handling for the ATTACHED binding — the pre-detach behavior,
  // unchanged: stamp createdAt, then hand the turn to the controller with the
  // mounted surface's identity.
  const handleAttachedFinish = async ({
    message,
    isAbort,
    isDisconnect,
    isError,
    finishReason,
  }: ChatStreamFinishEvent) => {
    const messageWithCreatedAt = message as ChatTurnMessage
    const finishedMessageCreatedAt =
      messageWithCreatedAt.createdAt ?? new Date()
    const finishedMessage: ChatTurnMessage = {
      ...message,
      createdAt: finishedMessageCreatedAt,
    }

    setMessages((prev) =>
      prev.map((currentMessage) => {
        const currentWithCreatedAt = currentMessage as ChatTurnMessage
        return currentMessage.id === finishedMessage.id &&
          !currentWithCreatedAt.createdAt
          ? { ...currentMessage, createdAt: finishedMessageCreatedAt }
          : currentMessage
      })
    )

    await chatTurn.finishChatTurn({
      message: finishedMessage,
      isAbort,
      isDisconnect,
      isError,
      finishReason,
      chatId,
      previousChatId: previousChatIdStore.get(),
    })
  }

  // Finish handling for a DETACHED binding — routes to the binding's frozen
  // origin, never to current navigation state. Durable chats are
  // server-persisted (ADR-0011) and get no client copy; guest/local chats
  // persist the (possibly partial) assistant message into the origin chat's
  // IndexedDB cache. Mounted-surface UI state (createdAt stamping in the live
  // array, lastFinishReason, error toasts) is deliberately skipped: it belongs
  // to whatever chat the surface shows now, not to this stream.
  const finishDetachedTurn = async (
    binding: ChatStreamBinding,
    { message }: ChatStreamFinishEvent
  ) => {
    if (binding.watchdog !== null) {
      clearTimeout(binding.watchdog)
      binding.watchdog = null
    }

    const ownerChatId = binding.ownerChatId
    if (!ownerChatId) return
    const routePersists = routePersistsChatMessages(ownerChatId, isAuthenticated)

    // Only this binding's own pending edit — a newer chat's staged edit must
    // survive an unrelated detached finish untouched.
    const pendingEdit = pendingEditStore.get()
    if (pendingEdit && pendingEdit.chatId === ownerChatId) {
      pendingEditStore.clear()
      if (!routePersists) {
        try {
          await cacheAndAddMessage(pendingEdit.message, ownerChatId)
        } catch (persistError) {
          console.error(
            "Failed to persist pending edit for a detached chat stream:",
            persistError
          )
        }
      }
    }

    if (routePersists) return
    const finishedMessage = message as ChatTurnMessage
    if (isEmptyAssistantMessage(finishedMessage)) return
    try {
      await cacheAndAddMessage(
        finishedMessage.createdAt
          ? finishedMessage
          : { ...finishedMessage, createdAt: new Date() },
        ownerChatId
      )
    } catch (persistError) {
      console.error(
        "Failed to persist a detached chat stream's assistant message:",
        persistError
      )
    }
  }

  // Latest-logic routing for the per-binding stream callbacks: business logic
  // stays current (this render's chatTurn/adapters), identity stays with the
  // binding. Synced post-render like the sibling refs above.
  useLayoutEffect(() => {
    streamHandlersRef.current = {
      onFinish: (binding, event) =>
        binding.detached
          ? finishDetachedTurn(binding, event)
          : handleAttachedFinish(event),
      onError: (binding, streamError) => {
        if (binding.detached) {
          // No toast: a detached stream's error has no visible surface here;
          // durable chats surface it through the run's terminal projection.
          console.error("Detached chat stream error:", streamError)
          return
        }
        handleError(streamError)
      },
    }
  })

  const handleToolApproval = useCallback(
    async (approvalId: string, approved: boolean, reason?: string) => {
      try {
        if (approved) {
          await approveToolCall({ approvalId, reason })
        } else {
          await denyToolCall({ approvalId, reason })
        }
        addToolApprovalResponse({ id: approvalId, approved, reason })
      } catch (error) {
        console.error("Failed to submit tool approval:", error)
        toast({
          title: "Failed to submit tool approval",
          status: "error",
        })
      }
    },
    [addToolApprovalResponse, approveToolCall, denyToolCall]
  )

  // Ref to latest stop function to avoid stale closures in effects
  const stopRef = useRef(stop)

  useEffect(() => {
    stopRef.current = stop
  }, [stop])

  // Generation guard: prevent stuck "streaming" UI when a stream drops silently
  useEffect(() => {
    if (status !== "streaming") return

    const timeout = setTimeout(() => {
      stopRef.current()
      toast({
        title: "Response timed out — please try again",
        status: "error",
      })
    }, STREAM_TIMEOUT_MS)

    return () => clearTimeout(timeout)
  }, [status])

  // Mounted chat-id transition bookkeeping — the commit side of the detach
  // (the binding replacement itself happens at render time, where the
  // semantics are documented). Marks the replaced binding detached, freezing
  // finish-time routing to its ownerChatId, and arms its watchdog: the same
  // hard time budget the attached stuck-stream guard enforces, so a detached
  // stream is stoppable by the system even though it has no user-facing Stop.
  // Also tracks the previous id for adoption-time fallbacks and forgets
  // hydration state for a chat we detached from, so re-entering it (Back then
  // Forward) hydrates the fresh binding from scratch — the same shape a
  // remount produces.
  const activeBindingRef = useRef(activeBinding)
  useEffect(() => {
    const previousBinding = activeBindingRef.current
    activeBindingRef.current = activeBinding
    if (previousBinding !== activeBinding) {
      previousBinding.detached = true
      previousBinding.watchdog = setTimeout(() => {
        previousBinding.chat.stop()
      }, STREAM_TIMEOUT_MS)
    }

    const prevChatId = previousChatIdStore.get()
    previousChatIdStore.set(chatId)

    if (prevChatId === chatId) return

    if (prevChatId !== null) {
      hydratedChatIdRef.current = null
    }
  }, [chatId, activeBinding, previousChatIdStore])

  // Hydrate on chat entry, then keep the live turn array projected onto the
  // backend-derived selected path. `initialMessages` is the reactive selected
  // path from the messages provider; for durable chats it is the source of
  // truth for ancestry and branch state. The single projection seam
  // (`projectSelectedPath`) installs it: adopting server ids + branch metadata,
  // preserving in-flight sends, and swapping wholesale on a branch switch.
  useEffect(() => {
    if (!chatId) return

    // Route through the ref, never the raw `setMessages` dep. The AI SDK's
    // `setMessages` is not referentially stable, so depending on it would re-run
    // this effect every render — and a project-then-set cycle becomes an
    // infinite render loop. The ref is the same seam the rest of this hook uses.
    const applyMessages = setMessagesRef.current

    const isNewChat = hydratedChatIdRef.current !== chatId
    if (isNewChat) {
      hydratedChatIdRef.current = chatId
      // A fresh conversation acquires its durable route before the messages
      // query is guaranteed to contain the optimistic user row (or the
      // assistant stream that may already have started). Route first entry
      // through the same selected-path seam as later snapshots so an empty or
      // partial server path cannot erase live turn state during that lag.
      applyMessages((live) =>
        projectSelectedPath(
          live as ChatTurnMessage[],
          initialMessages as ChatTurnMessage[]
        )
      )
      return
    }

    const isServerPersisted = getMessagePersistenceMode(chatId) === "server"
    if (!isServerPersisted) {
      // Guest/local chats have no server selected path to project.
      if (initialMessages.length > 0) {
        applyMessages((prev) => (prev.length === 0 ? initialMessages : prev))
      }
      return
    }

    // The AI SDK owns the array mid-stream; project once it settles. "error"
    // is included so a server-rejected edit/regenerate (e.g. the
    // expectedChatVersion guard) re-projects the last good selected path
    // instead of leaving the sliced-out messages vanished until reload.
    if (status !== "ready" && status !== "error") return
    if (initialMessages.length === 0) return

    const next = projectSelectedPath(
      messagesRef.current as ChatTurnMessage[],
      initialMessages as ChatTurnMessage[]
    )
    if (next !== messagesRef.current) {
      applyMessages(next)
    }
  }, [chatId, initialMessages, status])

  // Handle search params — hydrate the Composer's display from ?prompt= on
  // mount or navigation (the non-auto-submit form of a shared prompt link).
  useEffect(() => {
    if (prompt && !shouldAutoSubmitPrompt && typeof window !== "undefined") {
      requestAnimationFrame(() => setComposerText?.(prompt))
    }
  }, [prompt, shouldAutoSubmitPrompt, setComposerText])

  // Submit action — one send-type Chat turn from a Composer payload. Returns
  // whether the turn was accepted (dispatched), so the Composer knows whether
  // to clear its persisted draft.
  const submit = useCallback(
    async ({ text, files, attachments }: ChatTurnPayload): Promise<boolean> => {
      const submittedFiles = [...files]

      let accepted = false
      await chatTurn.runSendTurn({
        text,
        messages,
        submittedFiles,
        submittedAttachments: attachments,
        chatVersion: messages.length + 1, // current messages + 1 for the new message being sent
        onSuccess: (currentChatId) => {
          accepted = true
          if (messages.length > 0) {
            bumpChat(currentChatId)
          }
        },
      })
      return accepted
    },
    [chatTurn, messages, bumpChat]
  )

  const autoSubmittedPromptRef = useRef<string | null>(null)
  useEffect(() => {
    if (
      !chatId ||
      !prompt ||
      !shouldAutoSubmitPrompt ||
      typeof window === "undefined"
    ) {
      return
    }

    // Wait for model preferences to hydrate before dispatching, so the turn
    // snapshot resolves the user's model — not the tier default. The once-
    // guard is only consumed after this gate, so the effect retries on the
    // hydration commit.
    if (!turnContextHydrated) return

    const autoSubmitKey = `${chatId}:${prompt}`
    if (autoSubmittedPromptRef.current === autoSubmitKey) return
    autoSubmittedPromptRef.current = autoSubmitKey

    void (async () => {
      try {
        const accepted = await submit({
          text: prompt,
          files: [],
          attachments: [],
        })
        if (!accepted) {
          autoSubmittedPromptRef.current = null
          return
        }

        const nextUrl = new URL(window.location.href)
        nextUrl.searchParams.delete("prompt")
        nextUrl.searchParams.delete("autoSubmit")
        window.history.replaceState(
          window.history.state,
          "",
          `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`
        )
      } catch {
        autoSubmittedPromptRef.current = null
      }
    })()
  }, [chatId, prompt, shouldAutoSubmitPrompt, turnContextHydrated, submit])

  const { submitEdit } = useChatEdit({
    chatTurn,
    chatId,
    getMessages,
    getStatus,
    getIsSubmitting,
  })

  // Handle suggestion
  const handleSuggestion = useCallback(
    async (suggestion: string) => {
      await chatTurn.runSuggestionTurn({
        text: suggestion,
        messages,
        chatVersion: messages.length + 1, // current messages + 1 for the new message being sent
      })
    },
    [chatTurn, messages]
  )

  // Read live messages because memoized assistant rows retain this callback.
  const handleReload = useCallback(
    async (messageId: string) => {
      const currentMessages = getMessages()
      await chatTurn.runRegenerationTurn({
        chatId,
        messages: currentMessages,
        targetAssistantMessageId: messageId,
        chatVersion: currentMessages.length, // same count since we're regenerating, not adding
        isSubmitting: getIsSubmitting(),
        status: getStatus(),
      })
    },
    [chatTurn, chatId, getMessages, getIsSubmitting, getStatus]
  )

  return {
    // Chat state
    messages,
    status,
    error,
    stop,
    setMessages,
    isAuthenticated,
    systemPrompt,
    hasSentFirstMessage,
    setHasSentFirstMessage,

    // v5 API functions (exposed for direct access if needed)
    sendMessage,
    regenerate,

    // Component state
    isSubmitting,
    setIsSubmitting,
    hasDialogAuth,
    setHasDialogAuth,
    lastFinishReason,

    // Actions
    submit,
    handleSuggestion,
    handleReload,
    submitEdit,
    handleToolApproval,
  }
}
