import {
  createChatTurnController,
  type ChatTurnMessage,
} from "@/app/components/chat/chat-turn"
import { useChatEdit } from "@/app/components/chat/use-chat-edit"
import { useChatDraft } from "@/app/hooks/use-chat-draft"
import { toast } from "@/components/ui/toast"
import { api } from "@/convex/_generated/api"
import { getOrCreateGuestUserId } from "@/lib/api"
import { useChats } from "@/lib/chat-store/chats/provider"
import {
  createOptimisticMessageId,
  GUEST_CHAT_STORAGE_KEY,
} from "@/lib/chat-store/identity"
import { createChatTurnStore } from "@/lib/chat-store/turns/chat-turn-service"
import { SYSTEM_PROMPT_DEFAULT } from "@/lib/config"
import { Attachment } from "@/lib/file-handling"
import { API_ROUTE_CHAT } from "@/lib/routes"
import { useUserPreferences } from "@/lib/user-preference-store/provider"
import { resolveWebSearchEnabled } from "@/lib/user-preference-store/web-search"
import type { UserProfile } from "@/lib/user/types"
import { debounce } from "@/lib/utils"
import type { UIMessage } from "@ai-sdk/react"
import { useChat } from "@ai-sdk/react"
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai"
import { useMutation } from "convex/react"
import { useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

type UseChatCoreProps = {
  initialMessages: UIMessage[]
  draftValue: string
  /** Cache message locally and persist to Convex. Pass overrideChatId to handle stale closures during chat creation. */
  cacheAndAddMessage: (
    message: UIMessage,
    overrideChatId?: string
  ) => void | Promise<void>
  chatId: string | null
  user: UserProfile | null
  files: File[]
  createOptimisticAttachments: (
    files: File[]
  ) => Array<{ name: string; contentType: string; url: string }>
  setFiles: (files: File[]) => void
  checkLimitsAndNotify: (uid: string) => Promise<boolean>
  cleanupOptimisticAttachments: (attachments?: Array<{ url?: string }>) => void
  ensureChatExists: (uid: string, input: string) => Promise<string | null>
  handleFileUploads: (chatId: string) => Promise<Attachment[] | null>
  selectedModel: string
  clearDraft: () => void
  bumpChat: (chatId: string) => void
  deleteMessagesFromTimestamp: (
    timestamp: number,
    minVersion?: number
  ) => Promise<void>
}

export function useChatCore({
  initialMessages,
  draftValue,
  cacheAndAddMessage,
  chatId,
  user,
  files,
  createOptimisticAttachments,
  setFiles,
  checkLimitsAndNotify,
  cleanupOptimisticAttachments,
  ensureChatExists,
  handleFileUploads,
  selectedModel,
  clearDraft,
  bumpChat,
  deleteMessagesFromTimestamp,
}: UseChatCoreProps) {
  // State management
  const [isSubmitting, setIsSubmitting] = useState(false)
  const approveToolCall = useMutation(api.chatRuntime.approveToolCall)
  const denyToolCall = useMutation(api.chatRuntime.denyToolCall)
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
  const { preferences, setWebSearchEnabled } = useUserPreferences()
  const enableSearch = resolveWebSearchEnabled(preferences.webSearchEnabled)

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
  const isAuthenticated = useMemo(() => !!user?.id, [user?.id])
  const systemPrompt = useMemo(
    () => user?.system_prompt || SYSTEM_PROMPT_DEFAULT,
    [user?.system_prompt]
  )
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

  // Ref-based input management — avoids cascading re-renders on every keystroke.
  // ChatInput owns the display state; this ref is the source of truth for submit/handlers.
  const [initialInputValue] = useState(() => prompt || draftValue || "")
  const inputRef = useRef(initialInputValue)
  const inputListenerRef = useRef<((value: string) => void) | null>(null)

  const getInput = useCallback(() => inputRef.current, [])

  const registerInputListener = useCallback(
    (listener: ((value: string) => void) | null) => {
      inputListenerRef.current = listener
    },
    []
  )

  const setInputValue = useCallback((value: string) => {
    inputRef.current = value
    inputListenerRef.current?.(value)
  }, [])

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
      await chatTurn.finishChatTurn({
        message,
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

  const getIsSending = useCallback(
    () => isSendingStore.get(),
    [isSendingStore]
  )

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

  const turnStore = useMemo(
    () =>
      createChatTurnStore({
        isAuthenticated: () => isAuthenticated,
        updateMessages: (updater) => setMessages(updater),
        cacheAndAddMessage,
        deleteMessagesFromTimestamp,
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
      }),
    [
      isAuthenticated,
      setMessages,
      cacheAndAddMessage,
      deleteMessagesFromTimestamp,
      updateTitle,
      stagePendingEdit,
      getPendingEdit,
      clearPendingEdit,
    ]
  )

  const chatTurn = createChatTurnController({
    createOptimisticMessageId,
    getIsSending,
    setIsSending,
    setIsSubmitting,
    setHasSentFirstMessage,
    setMessages: (action) => setMessages(action),
    turnStore,
    resolveUserId: () => getOrCreateGuestUserId(user),
    checkLimitsAndNotify,
    ensureChatExists,
    setPreviousChatId,
    cleanupOptimisticAttachments,
    handleFileUploads,
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

  // Handle chat transitions: stop active streams, reset state.
  // IMPORTANT: This effect MUST run before the hydration effect below so that
  // chat-to-chat navigation correctly stops the old stream before setting new messages.
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

  useEffect(() => {
    if (!chatId) return

    const isNewChat = hydratedChatIdRef.current !== chatId
    if (isNewChat) {
      hydratedChatIdRef.current = chatId
      setMessages(initialMessages)
      return
    }

    if (initialMessages.length > 0) {
      setMessages((prev) => (prev.length === 0 ? initialMessages : prev))
    }
  }, [chatId, initialMessages, setMessages])

  // Handle search params — hydrate input from ?prompt= on mount or navigation
  useEffect(() => {
    if (prompt && typeof window !== "undefined") {
      requestAnimationFrame(() => setInputValue(prompt))
    }
  }, [prompt, setInputValue])

  const setEnableSearch = useCallback(
    (enabled: boolean) => {
      setWebSearchEnabled(enabled)
    },
    [setWebSearchEnabled]
  )

  // Debounced draft persistence — avoids writing to localStorage on every keystroke.
  // Declared before submit so submit's onSuccess can call .cancel().
  const { setDraftValue } = useChatDraft(chatId)

  const debouncedSetDraftValue = useMemo(
    () => debounce((value: string) => setDraftValue(value), 500),
    [setDraftValue]
  )

  useEffect(
    () => () => {
      debouncedSetDraftValue.cancel()
    },
    [debouncedSetDraftValue]
  )

  // Submit action
  const submit = useCallback(async () => {
    const currentInput = inputRef.current
    const optimisticAttachments =
      files.length > 0 ? createOptimisticAttachments(files) : []
    const submittedFiles = [...files]

    setInputValue("")
    setFiles([])

    await chatTurn.runSendTurn({
      text: currentInput,
      selectedModel,
      isAuthenticated,
      submittedFiles,
      optimisticAttachments,
      bodyExtras: {
        systemPrompt: systemPrompt || SYSTEM_PROMPT_DEFAULT,
        enableSearch,
        chatVersion: messages.length + 1, // current messages + 1 for the new message being sent
      },
      onSuccess: (currentChatId) => {
        debouncedSetDraftValue.cancel()
        clearDraft()
        if (messages.length > 0) {
          bumpChat(currentChatId)
        }
      },
    })
  }, [
    files,
    createOptimisticAttachments,
    setInputValue,
    setFiles,
    chatTurn,
    selectedModel,
    isAuthenticated,
    systemPrompt,
    enableSearch,
    debouncedSetDraftValue,
    clearDraft,
    messages.length,
    bumpChat,
  ])

  const { submitEdit } = useChatEdit({
    chatTurn,
    chatId,
    messages,
    selectedModel,
    isAuthenticated,
    systemPrompt,
    enableSearch,
    isSubmitting,
    status,
  })

  // Handle suggestion
  const handleSuggestion = useCallback(
    async (suggestion: string) => {
      await chatTurn.runSuggestionTurn({
        text: suggestion,
        selectedModel,
        isAuthenticated,
        chatVersion: messages.length + 1, // current messages + 1 for the new message being sent
      })
    },
    [chatTurn, selectedModel, isAuthenticated, messages.length]
  )

  // Handle reload (v6: renamed to regenerate)
  const handleReload = useCallback(async (messageId: string) => {
    await chatTurn.runRegenerationTurn({
      chatId,
      messages,
      targetAssistantMessageId: messageId,
      selectedModel,
      isAuthenticated,
      systemPrompt,
      chatVersion: messages.length, // same count since we're regenerating, not adding
    })
  }, [
    chatTurn,
    chatId,
    selectedModel,
    isAuthenticated,
    systemPrompt,
    messages,
  ])

  // Flush pending draft on tab close; also flush on unmount (navigation)
  useEffect(() => {
    const flush = () => debouncedSetDraftValue.flush()
    window.addEventListener("beforeunload", flush)
    return () => {
      window.removeEventListener("beforeunload", flush)
      debouncedSetDraftValue.flush()
    }
  }, [debouncedSetDraftValue])

  const handleInputChange = useCallback(
    (value: string) => {
      inputRef.current = value
      debouncedSetDraftValue(value)
    },
    [debouncedSetDraftValue]
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

    // Ref-based input API (no useState — avoids cascading re-renders)
    initialInputValue,
    inputRef,
    getInput,
    setInputValue,
    registerInputListener,

    // v5 API functions (exposed for direct access if needed)
    sendMessage,
    regenerate,

    // Component state
    isSubmitting,
    setIsSubmitting,
    hasDialogAuth,
    setHasDialogAuth,
    enableSearch,
    setEnableSearch,
    lastFinishReason,

    // Actions
    submit,
    handleSuggestion,
    handleReload,
    handleInputChange,
    submitEdit,
    handleToolApproval,
  }
}
