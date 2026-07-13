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
} from "@/lib/chat-turn/chat-turn-controller"
import { attachStagedFilesToChat, type Attachment } from "@/lib/file-handling"
import { API_ROUTE_CHAT } from "@/lib/routes"
import type { UserProfile } from "@/lib/user/types"
import type { UIMessage } from "@ai-sdk/react"
import { useChat } from "@ai-sdk/react"
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
  attachments: Attachment[]
}

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
  ensureChatExists: (uid: string, input: string) => Promise<string | null>
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

  // Search params handling
  const searchParams = useSearchParams()
  const prompt = searchParams.get("prompt")
  const shouldAutoSubmitPrompt = searchParams.get("autoSubmit") === "1"
  const handoffAttachmentIds = useMemo(
    () => searchParams.getAll("attachment"),
    [searchParams]
  )

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

  // Initialize useChat with v6 API
  const {
    messages,
    sendMessage,
    regenerate,
    status,
    error,
    stop,
    setMessages,
    addToolApprovalResponse,
  } = useChat({
    transport,
    messages: initialMessages,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,

    onFinish: async ({
      message,
      isAbort,
      isDisconnect,
      isError,
      finishReason,
    }) => {
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
    },

    onError: handleError,
  })

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
    }, 120_000)

    return () => clearTimeout(timeout)
  }, [status])

  // Mounted chat-id transitions stop the old stream before hydration. Link
  // navigation remounts Chat and intentionally leaves durable streaming alive.
  useEffect(() => {
    const prevChatId = previousChatIdStore.get()
    previousChatIdStore.set(chatId)

    // Only act when chatId actually changed
    if (prevChatId === chatId) return

    // Stop any active stream from the previous chat
    if (prevChatId !== null) {
      stopRef.current()
    }

    // When navigating to home, clear messages and reset tracking state
    if (chatId === null) {
      setMessages([])
    }
  }, [chatId, previousChatIdStore, setMessages])

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

    const autoSubmitKey = `${chatId}:${prompt}:${handoffAttachmentIds.join(",")}`
    if (autoSubmittedPromptRef.current === autoSubmitKey) return
    autoSubmittedPromptRef.current = autoSubmitKey

    void (async () => {
      try {
        const attachments = await attachStagedFilesToChat(
          convex,
          chatId,
          handoffAttachmentIds
        )
        const accepted = await submit({ text: prompt, files: [], attachments })
        if (!accepted) {
          autoSubmittedPromptRef.current = null
          return
        }

        const nextUrl = new URL(window.location.href)
        nextUrl.searchParams.delete("prompt")
        nextUrl.searchParams.delete("autoSubmit")
        nextUrl.searchParams.delete("attachment")
        window.history.replaceState(
          window.history.state,
          "",
          `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`
        )
      } catch {
        autoSubmittedPromptRef.current = null
        toast({ title: "Failed to prepare attachments.", status: "error" })
      }
    })()
  }, [
    chatId,
    convex,
    handoffAttachmentIds,
    prompt,
    shouldAutoSubmitPrompt,
    turnContextHydrated,
    submit,
  ])

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
