import { syncRecentMessages } from "@/app/components/chat/syncRecentMessages"
import { useChatEdit } from "@/app/components/chat/use-chat-edit"
import { useChatDraft } from "@/app/hooks/use-chat-draft"
import { toast } from "@/components/ui/toast"
import { api } from "@/convex/_generated/api"
import { convertAttachmentsToFiles } from "@/lib/ai/message-conversion"
import { getOrCreateGuestUserId } from "@/lib/api"
import { useChats } from "@/lib/chat-store/chats/provider"
import { MESSAGE_MAX_LENGTH, SYSTEM_PROMPT_DEFAULT } from "@/lib/config"
import { Attachment } from "@/lib/file-handling"
import { API_ROUTE_CHAT } from "@/lib/routes"
import {
  persistWebSearchToggle,
  resolveWebSearchEnabled,
} from "@/lib/user-preference-store/web-search"
import { useUserPreferences } from "@/lib/user-preference-store/provider"
import type { UserProfile } from "@/lib/user/types"
import type { UIMessage } from "@ai-sdk/react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from "ai"
import { useMutation } from "convex/react"
import { useSearchParams } from "next/navigation"
import { debounce } from "@/lib/utils"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

// Extended UIMessage type for optimistic updates that includes createdAt
type OptimisticUIMessage = UIMessage & { createdAt?: Date }

function isRouteDurableChat(chatId: string | null, isAuthenticated: boolean) {
  return Boolean(
    isAuthenticated &&
      chatId &&
      !chatId.startsWith("optimistic-") &&
      !chatId.startsWith("local-")
  )
}

type UseChatCoreProps = {
  initialMessages: UIMessage[]
  draftValue: string
  /** Cache message locally and persist to Convex. Pass overrideChatId to handle stale closures during chat creation. */
  cacheAndAddMessage: (message: UIMessage, overrideChatId?: string) => void
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
  // Ref-based guard prevents concurrent sends (state updates are batched and can lag)
  const isSendingRef = useRef(false)

  // Deferred edit persistence: stores the edited user message so onFinish can
  // persist it AFTER the stream completes, avoiding provider state mutations
  // during the same React batch as sendMessage/setMessages.
  const pendingEditUserMsgRef = useRef<{
    message: UIMessage & { createdAt?: Date }
    chatId: string
  } | null>(null)

  const setPendingEditUserMessage = useCallback(
    (message: UIMessage, chatId: string) => {
      pendingEditUserMsgRef.current = { message, chatId }
    },
    []
  )
  const [hasDialogAuth, setHasDialogAuth] = useState(false)
  const { preferences, setWebSearchEnabled } = useUserPreferences()
  const [enableSearch, setEnableSearchState] = useState(() =>
    resolveWebSearchEnabled(preferences.webSearchEnabled)
  )

  // Track the finish reason of the last assistant message.
  // Used to show a truncation indicator when finishReason is "length".
  const [lastFinishReason, setLastFinishReason] = useState<string | undefined>()

  // State for tracking first message sent (prevents redirect after sending)
  const [hasSentFirstMessage, setHasSentFirstMessage] = useState(false)
  const prevChatIdRef = useRef<string | null>(chatId)
  const hydratedChatIdRef = useRef<string | null>(null)
  const isAuthenticated = useMemo(() => !!user?.id, [user?.id])
  const systemPrompt = useMemo(
    () => user?.system_prompt || SYSTEM_PROMPT_DEFAULT,
    [user?.system_prompt]
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

    onFinish: async ({ message, isAbort, isDisconnect, isError, finishReason }) => {
      // Track finish reason for truncation detection
      setLastFinishReason(finishReason)

      // If a stream aborts/errors, still try to persist any pending edited user
      // message so edit truncation is not lost from persistence.
      if (isAbort || isDisconnect || isError) {
        const pendingEdit = pendingEditUserMsgRef.current
        if (pendingEdit) {
          pendingEditUserMsgRef.current = null
          if (isRouteDurableChat(pendingEdit.chatId, isAuthenticated)) {
            return
          }
          try {
            await cacheAndAddMessage(pendingEdit.message, pendingEdit.chatId)
          } catch (error) {
            // Re-stage for a future retry rather than dropping the edit.
            pendingEditUserMsgRef.current = pendingEdit
            console.error(
              "Failed to persist pending edited message on abort/error:",
              error
            )
          }
        }
        return
      }

      // Use effectiveChatId to handle stale closures during chat creation
      const effectiveChatId =
        chatId ||
        prevChatIdRef.current ||
        (typeof window !== "undefined"
          ? localStorage.getItem("guestChatId")
          : null)

      if (effectiveChatId) {
        const routePersistsMessages = isRouteDurableChat(
          effectiveChatId,
          isAuthenticated
        )
        // Persist the edited user message first (if any) so the user→assistant
        // pair is written in order before ID reconciliation.
        const pendingEdit = pendingEditUserMsgRef.current
        if (pendingEdit) {
          pendingEditUserMsgRef.current = null
          if (!routePersistsMessages) {
            await cacheAndAddMessage(pendingEdit.message, pendingEdit.chatId)
          }
        }

        if (!routePersistsMessages) {
          // Await persistence so the DB has the latest messages before ID reconciliation
          await cacheAndAddMessage(message, effectiveChatId)
        }
      }

      try {
        if (!effectiveChatId) return
        await syncRecentMessages(effectiveChatId, setMessages, 2)
      } catch (error) {
        console.error("Message ID reconciliation failed: ", error)
      }
    },

    onError: handleError,
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
  stopRef.current = stop

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
    const prevChatId = prevChatIdRef.current
    prevChatIdRef.current = chatId

    // Only act when chatId actually changed
    if (prevChatId === chatId) return

    // Stop any active stream from the previous chat
    if (prevChatId !== null) {
      stopRef.current()
    }

    // Clear stale finish reason so truncation indicators don't carry over
    setLastFinishReason(undefined)

    // When navigating to home, clear messages and reset tracking state
    if (chatId === null) {
      setMessages([])
      setHasSentFirstMessage(false)
    }
  }, [chatId, setMessages])

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

  useEffect(() => {
    setEnableSearchState(resolveWebSearchEnabled(preferences.webSearchEnabled))
  }, [preferences.webSearchEnabled])

  const setEnableSearch = useCallback(
    (enabled: boolean) => {
      persistWebSearchToggle(enabled, setEnableSearchState, setWebSearchEnabled)
    },
    [setWebSearchEnabled]
  )

  // Debounced draft persistence — avoids writing to localStorage on every keystroke.
  // Declared before executeSend/submit so submit's onSuccess can call .cancel().
  const { setDraftValue } = useChatDraft(chatId)
  const setDraftValueRef = useRef(setDraftValue)
  setDraftValueRef.current = setDraftValue

  const debouncedSetDraftValue = useMemo(
    () => debounce((value: string) => setDraftValueRef.current(value), 500),
    []
  )

  // Shared send logic — used by both submit and handleSuggestion to avoid
  // duplicating optimistic-message creation, validation, and error rollback.
  const executeSend = useCallback(
    async ({
      text,
      submittedFiles = [],
      optimisticAttachments = [],
      bodyExtras = {},
      onSuccess,
      errorMessage = "Failed to send message",
    }: {
      text: string
      submittedFiles?: File[]
      optimisticAttachments?: Array<{
        name: string
        contentType: string
        url: string
      }>
      bodyExtras?: Record<string, unknown>
      onSuccess?: (chatId: string) => void
      errorMessage?: string
    }) => {
      // Synchronous ref guard: prevents duplicate sends from rapid clicks/key repeats
      // (React state updates are batched and may not reflect in time)
      if (isSendingRef.current) return
      isSendingRef.current = true
      setIsSubmitting(true)

      const optimisticId = `optimistic-${crypto.randomUUID()}`
      const optimisticMessage: OptimisticUIMessage = {
        id: optimisticId,
        role: "user",
        createdAt: new Date(),
        parts: [
          { type: "text", text },
          ...optimisticAttachments.map((att) => ({
            type: "file" as const,
            filename: att.name,
            mediaType: att.contentType,
            url: att.url,
          })),
        ],
      }

      setMessages((prev) => [...prev, optimisticMessage])

      const getFileUrlsFromParts = () =>
        optimisticMessage.parts
          ?.filter((p) => p.type === "file")
          .map((p) => ({ url: (p as { url?: string }).url })) || []

      const removeOptimistic = () => {
        setMessages((prev) => prev.filter((msg) => msg.id !== optimisticId))
        cleanupOptimisticAttachments(getFileUrlsFromParts())
      }

      try {
        const uid = await getOrCreateGuestUserId(user)
        if (!uid) return

        const allowed = await checkLimitsAndNotify(uid)
        if (!allowed) {
          removeOptimistic()
          return
        }

        const currentChatId = await ensureChatExists(uid, text)
        if (!currentChatId) {
          removeOptimistic()
          return
        }

        prevChatIdRef.current = currentChatId

        if (text.length > MESSAGE_MAX_LENGTH) {
          toast({
            title: `The message you submitted was too long, please submit something shorter. (Max ${MESSAGE_MAX_LENGTH} characters)`,
            status: "error",
          })
          removeOptimistic()
          return
        }

        let attachments: Attachment[] | null = []
        if (submittedFiles.length > 0) {
          attachments = await handleFileUploads(currentChatId)
          if (attachments === null) {
            removeOptimistic()
            return
          }
        }

        sendMessage(
          {
            text,
            files: attachments?.length
              ? convertAttachmentsToFiles(attachments)
              : undefined,
          },
          {
            body: {
              chatId: currentChatId,
              userId: uid,
              model: selectedModel,
              isAuthenticated,
              systemPrompt: SYSTEM_PROMPT_DEFAULT,
              ...bodyExtras,
            },
          }
        )

        setHasSentFirstMessage(true)
        removeOptimistic()
        if (!isRouteDurableChat(currentChatId, isAuthenticated)) {
          cacheAndAddMessage(optimisticMessage, currentChatId)
        }
        onSuccess?.(currentChatId)
      } catch {
        removeOptimistic()
        toast({ title: errorMessage, status: "error" })
      } finally {
        isSendingRef.current = false
        setIsSubmitting(false)
      }
    },
    [
      user,
      setMessages,
      cleanupOptimisticAttachments,
      checkLimitsAndNotify,
      ensureChatExists,
      handleFileUploads,
      sendMessage,
      selectedModel,
      isAuthenticated,
      cacheAndAddMessage,
    ]
  )

  // Submit action
  const submit = useCallback(async () => {
    const currentInput = inputRef.current
    const optimisticAttachments =
      files.length > 0 ? createOptimisticAttachments(files) : []
    const submittedFiles = [...files]

    setInputValue("")
    setFiles([])

    await executeSend({
      text: currentInput,
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
    executeSend,
    systemPrompt,
    enableSearch,
    debouncedSetDraftValue,
    clearDraft,
    messages.length,
    bumpChat,
  ])

  const { submitEdit } = useChatEdit({
    chatId,
    messages,
    user,
    checkLimitsAndNotify,
    ensureChatExists,
    selectedModel,
    isAuthenticated,
    systemPrompt,
    enableSearch,
    sendMessage,
    setMessages,
    setPendingEditUserMessage,
    bumpChat,
    updateTitle,
    isSubmitting,
    status,
    deleteMessagesFromTimestamp,
    prevChatIdRef,
  })

  // Handle suggestion
  const handleSuggestion = useCallback(
    async (suggestion: string) => {
      await executeSend({
        text: suggestion,
        bodyExtras: {
          chatVersion: messages.length + 1, // current messages + 1 for the new message being sent
        },
        errorMessage: "Failed to send suggestion",
      })
    },
    [executeSend, messages.length]
  )

  // Handle reload (v6: renamed to regenerate)
  const handleReload = useCallback(async () => {
    const uid = await getOrCreateGuestUserId(user)
    if (!uid) {
      return
    }

    const options = {
      body: {
        chatId,
        userId: uid,
        model: selectedModel,
        isAuthenticated,
        systemPrompt: systemPrompt || SYSTEM_PROMPT_DEFAULT,
        chatVersion: messages.length, // same count since we're regenerating, not adding
      },
    }

    regenerate(options)
  }, [user, chatId, selectedModel, isAuthenticated, systemPrompt, regenerate, messages.length])

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
