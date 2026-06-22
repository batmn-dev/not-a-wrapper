"use client"

import { ChatInput } from "@/app/components/chat-input/chat-input"
import { Conversation } from "@/app/components/chat/conversation"
import { useModel } from "@/app/components/chat/use-model"
import { useChatDraft } from "@/app/hooks/use-chat-draft"
import { useGlobalPromptFocus } from "@/app/hooks/use-global-prompt-focus"
import { ScrollButton } from "@/components/ui/scroll-button"
import { useChats } from "@/lib/chat-store/chats/provider"
import { useMessages } from "@/lib/chat-store/messages/provider"
import { useChatSession } from "@/lib/chat-store/session/provider"
import { SYSTEM_PROMPT_DEFAULT } from "@/lib/config"
import { useUserPreferences } from "@/lib/user-preference-store/provider"
import { useUser } from "@/lib/user-store/provider"
import { cn } from "@/lib/utils"
import { AnimatePresence, motion } from "motion/react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { isRouteDurableChat } from "./chat-turn"
import { useChatCore } from "./use-chat-core"
import { useChatOperations } from "./use-chat-operations"
import { useFileUpload } from "./use-file-upload"

const DialogAuth = dynamic(
  () => import("./dialog-auth").then((mod) => mod.DialogAuth),
  { ssr: false }
)

export function Chat() {
  const router = useRouter()
  const { chatId } = useChatSession()
  const {
    createNewChat,
    getChatById,
    updateChatModel,
    bumpChat,
    isLoading: isChatsLoading,
  } = useChats()

  const currentChat = useMemo(
    () => (chatId ? getChatById(chatId) : null),
    [chatId, getChatById]
  )

  const {
    messages: initialMessages,
    cacheAndAddMessage,
    selectMessageBranch,
  } = useMessages()
  const { user } = useUser()
  const { preferences } = useUserPreferences()
  const { draftValue, clearDraft } = useChatDraft(chatId)

  // File upload functionality
  const {
    files,
    setFiles,
    handleFileUploads,
    createOptimisticAttachments,
    cleanupOptimisticAttachments,
    handleFileUpload,
    handleFileRemove,
  } = useFileUpload()

  // Model selection
  const { selectedModel, handleModelChange } = useModel({
    currentChat: currentChat || null,
    user,
    updateChatModel,
    chatId,
  })

  // State to pass between hooks
  const [hasDialogAuth, setHasDialogAuth] = useState(false)
  const isAuthenticated = useMemo(() => !!user?.id, [user?.id])
  // Edit and regeneration are server-owned Chat turns, available only on a
  // durable chat. Drives whether the message tree shows those controls so the
  // UI agrees with the turn-controller precondition. See CONTEXT.md "Chat turn".
  const isDurableChat = useMemo(
    () => isRouteDurableChat(chatId, isAuthenticated),
    [chatId, isAuthenticated]
  )
  const systemPrompt = useMemo(
    () => user?.system_prompt || SYSTEM_PROMPT_DEFAULT,
    [user?.system_prompt]
  )
  const navigateToChat = useCallback(
    (nextChatId: string) => {
      window.history.pushState(null, "", `/c/${nextChatId}`)
    },
    []
  )

  // New state for quoted text
  const [quotedText, setQuotedText] = useState<{
    text: string
    messageId: string
  }>()
  const handleQuotedSelected = useCallback(
    (text: string, messageId: string) => {
      setQuotedText({ text, messageId })
    },
    []
  )

  // Chat operations (pure async utilities) - created first
  const { checkLimitsAndNotify, ensureChatExists } = useChatOperations({
    isAuthenticated,
    chatId,
    selectedModel,
    systemPrompt,
    createNewChat,
    navigateToChat,
    setHasDialogAuth,
  })

  // Core chat functionality (initialization + state + actions)
  const {
    messages,
    setMessages,
    initialInputValue,
    registerInputListener,
    status,
    stop,
    hasSentFirstMessage,
    isSubmitting,
    enableSearch,
    setEnableSearch,
    lastFinishReason,
    submit,
    handleSuggestion,
    handleReload,
    handleInputChange,
    submitEdit,
    handleToolApproval,
  } = useChatCore({
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
  })

  // Local delete handler — filters a message from the local array
  const handleDelete = useCallback(
    (id: string) => {
      setMessages((prev) => prev.filter((message) => message.id !== id))
    },
    [setMessages]
  )

  // Auto-focus chat textarea when user types a printable character anywhere
  const focusTextareaRef = useRef<(() => void) | null>(null)
  useGlobalPromptFocus(focusTextareaRef)

  const registerFocus = useCallback((fn: (() => void) | null) => {
    focusTextareaRef.current = fn
  }, [])

  // Memoize the conversation props to prevent unnecessary rerenders
  const conversationProps = useMemo(
    () => ({
      messages,
      status,
      isSubmitting,
      onDelete: handleDelete,
      onEdit: submitEdit,
      onReload: handleReload,
      onStop: stop,
      onQuote: handleQuotedSelected,
      onSelectBranch: selectMessageBranch,
      isDurableChat,
      lastFinishReason,
      onToolApproval: handleToolApproval,
    }),
    [
      messages,
      status,
      isSubmitting,
      handleDelete,
      submitEdit,
      handleReload,
      stop,
      handleQuotedSelected,
      selectMessageBranch,
      isDurableChat,
      lastFinishReason,
      handleToolApproval,
    ]
  )

  // Memoize the chat input props
  const chatInputProps = useMemo(
    () => ({
      onSuggestion: handleSuggestion,
      onValueChange: handleInputChange,
      onSend: submit,
      isSubmitting,
      files,
      onFileUpload: handleFileUpload,
      onFileRemove: handleFileRemove,
      hasSuggestions:
        preferences.promptSuggestions && !chatId && messages.length === 0,
      selectedModel,
      onSelectModel: handleModelChange,
      onLockedGuestModelSelect: () => setHasDialogAuth(true),
      isUserAuthenticated: isAuthenticated,
      stop,
      status,
      setEnableSearch,
      enableSearch,
      quotedText,
      registerInputListener,
      registerFocus,
    }),
    [
      handleSuggestion,
      handleInputChange,
      submit,
      isSubmitting,
      files,
      handleFileUpload,
      handleFileRemove,
      preferences.promptSuggestions,
      chatId,
      messages.length,
      selectedModel,
      handleModelChange,
      isAuthenticated,
      stop,
      status,
      setEnableSearch,
      enableSearch,
      quotedText,
      registerInputListener,
      registerFocus,
    ]
  )

  // Track if we should redirect - use ref to track if redirect was triggered
  const hasRedirectedRef = useRef(false)

  // Handle redirect for invalid chatId - only redirect if we're certain the chat doesn't exist
  // and we're not in a transient state during chat creation
  useEffect(() => {
    if (
      chatId &&
      !isChatsLoading &&
      !currentChat &&
      !isSubmitting &&
      status === "ready" &&
      messages.length === 0 &&
      !hasSentFirstMessage && // Don't redirect if we've already sent a message in this session
      !hasRedirectedRef.current
    ) {
      hasRedirectedRef.current = true
      router.replace("/")
    }
  }, [
    chatId,
    isChatsLoading,
    currentChat,
    isSubmitting,
    status,
    messages.length,
    hasSentFirstMessage,
    router,
  ])

  const showOnboarding = !chatId && messages.length === 0

  return (
    <div id="thread" className="group/thread flex min-h-full flex-1 flex-col">
      <DialogAuth open={hasDialogAuth} setOpen={setHasDialogAuth} />

      <div
        role="presentation"
        className="composer-parent flex flex-1 flex-col focus-visible:outline-0"
      >
        <AnimatePresence initial={false} mode="popLayout">
          {showOnboarding ? (
            <motion.div
              key="onboarding"
              className="relative flex shrink basis-auto flex-col justify-end max-sm:grow max-sm:justify-center sm:min-h-[calc(42svh-var(--spacing-app-header))]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div
                className="flex justify-center"
                data-splash-headline-option="WHATS_ON_YOUR_MIND"
              >
                <div className="hidden text-center sm:mb-[22px] sm:block">
                  <h1 className="inline-flex min-h-[42px] items-baseline px-1 text-2xl leading-9 font-normal text-balance">
                    What&apos;s on your mind?
                  </h1>
                </div>
                <div className="flex h-full w-full shrink flex-col items-center justify-center px-4 text-center sm:hidden">
                  <h1 className="inline-flex min-h-[42px] items-baseline px-1 text-2xl leading-9 font-normal text-balance">
                    What&apos;s on your mind?
                  </h1>
                </div>
              </div>
            </motion.div>
          ) : (
            <Conversation key="conversation" {...conversationProps} />
          )}
        </AnimatePresence>

        <div
          id="thread-bottom-container"
          className={cn(
            "group/thread-bottom-container sticky bottom-0 isolate z-10 flex min-h-0 w-full basis-auto flex-col px-[var(--thread-content-margin,1rem)] pb-[env(safe-area-inset-bottom,0px)] [--thread-content-margin:1rem] @sm/main:[--thread-content-margin:1.5rem] @lg/main:[--thread-content-margin:4rem]",
            showOnboarding ? "sm:grow" : "content-fade"
          )}
        >
          {!showOnboarding && (
            <div className="relative h-0">
              <div className="pointer-events-none absolute inset-x-0 bottom-[calc(100%+1.5rem)] z-30 flex justify-center">
                <div className="pointer-events-auto">
                  <ScrollButton />
                </div>
              </div>
            </div>
          )}
          <div
            id="thread-bottom"
            className="mx-auto w-full max-w-[var(--thread-content-max-width,40rem)] [--thread-content-max-width:40rem] @[64rem]/main:[--thread-content-max-width:48rem]"
          >
            <ChatInput defaultValue={initialInputValue} {...chatInputProps} />
          </div>
          {!showOnboarding && (
            <div className="text-muted-foreground relative -mt-4 w-full overflow-hidden text-center text-xs md:px-[60px]">
              <div className="flex min-h-8 w-full items-center justify-center p-2 select-none">
                <div className="pointer-events-auto">
                  <div>
                    Not A Wrapper can make mistakes. Check important info.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
