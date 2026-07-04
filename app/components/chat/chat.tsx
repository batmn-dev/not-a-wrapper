"use client"

import {
  Composer,
  type ComposerHandle,
} from "@/app/components/chat-input/composer"
import { Conversation } from "@/app/components/chat/conversation"
import { useBrowserLayoutEffect } from "@/app/hooks/use-browser-layout-effect"
import { useGlobalPromptFocus } from "@/app/hooks/use-global-prompt-focus"
import { ScrollButton } from "@/components/ui/scroll-button"
import { useChats } from "@/lib/chat-store/chats/provider"
import { useChat } from "@/lib/chat-store/chats/use-chat"
import { useMessages } from "@/lib/chat-store/messages/provider"
import { useChatSession } from "@/lib/chat-store/session/provider"
import type { Chats } from "@/lib/chat-store/types"
import { useUserPreferences } from "@/lib/user-preference-store/provider"
import { useUser } from "@/lib/user-store/provider"
import { cn } from "@/lib/utils"
import { AnimatePresence, motion } from "motion/react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { ActivityPanel } from "./activity/activity-panel"
import {
  ActivityPanelStoreProvider,
  createActivityPanelStore,
  useActivityPanelOpen,
  useActivityPanelSelectedTurnId,
} from "./activity/activity-panel-store"
import { ChatStatusAnnouncer } from "./chat-announcer"
import { isRouteDurableChat } from "./chat-turn"
import { THREAD_GUTTER_VARS, THREAD_MAXWIDTH_VARS } from "./thread-bounds"
import { TurnContextProvider, useTurnContext } from "./turn-context"
import { useActivityPanel } from "./use-activity-panel"
import { useChatCore } from "./use-chat-core"
import { useChatOperations } from "./use-chat-operations"

const DialogAuth = dynamic(
  () => import("./dialog-auth").then((mod) => mod.DialogAuth),
  { ssr: false }
)

/**
 * Chat — resolves the route's chat and hosts the Turn context (model, search,
 * system prompt — the inputs every Chat turn snapshots at run time). The body
 * lives in ChatInner so its hooks read the context.
 */
export function Chat() {
  const { chatId } = useChatSession()
  // Resolve the current chat even when it is outside the bounded sidebar window
  // (deep-links to old chats). In-window chats resolve synchronously; out-of-
  // window chats load via the chats.getById fallback (isChatLoading).
  const { chat: currentChat, isLoading: isChatLoading } = useChat(chatId)

  return (
    <TurnContextProvider chatId={chatId} currentChat={currentChat || null}>
      <ChatInner
        chatId={chatId}
        currentChat={currentChat || null}
        isChatLoading={isChatLoading}
      />
    </TurnContextProvider>
  )
}

function ChatInner({
  chatId,
  currentChat,
  isChatLoading,
}: {
  chatId: string | null
  currentChat: Chats | null
  isChatLoading: boolean
}) {
  const router = useRouter()
  const { createNewChat, bumpChat, isLoading: isChatsLoading } = useChats()

  const {
    messages: initialMessages,
    cacheAndAddMessage,
    selectMessageBranch,
  } = useMessages()
  const { user } = useUser()
  const { preferences } = useUserPreferences()

  // Turn inputs — reactive reads for rendering; the turn runners read the
  // same values at run time through the context's snapshot getter.
  const { selectedModel, isAuthenticated, systemPrompt } = useTurnContext()

  // State to pass between hooks
  const [hasDialogAuth, setHasDialogAuth] = useState(false)
  // Edit and regeneration are server-owned Chat turns, available only on a
  // durable chat. Drives whether the message tree shows those controls so the
  // UI agrees with the turn-controller precondition. See CONTEXT.md "Chat turn".
  const isDurableChat = useMemo(
    () => isRouteDurableChat(chatId, isAuthenticated),
    [chatId, isAuthenticated]
  )
  const navigateToChat = useCallback((nextChatId: string) => {
    window.history.pushState(null, "", `/c/${nextChatId}`)
  }, [])

  // The Composer's imperative handle — quote insertion, ?prompt= hydration,
  // and global focus are commands into the Composer, not state threaded
  // through props.
  const composerRef = useRef<ComposerHandle>(null)
  const setComposerText = useCallback((text: string) => {
    composerRef.current?.setText(text)
  }, [])
  const handleQuotedSelected = useCallback((text: string) => {
    composerRef.current?.insertQuote(text)
  }, [])

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
    status,
    stop,
    hasSentFirstMessage,
    isSubmitting,
    lastFinishReason,
    submit,
    handleSuggestion,
    handleReload,
    submitEdit,
    handleToolApproval,
  } = useChatCore({
    initialMessages,
    cacheAndAddMessage,
    chatId,
    user,
    checkLimitsAndNotify,
    ensureChatExists,
    bumpChat,
    setComposerText,
  })

  // The Activity panel store — the seam assistant rows use to reach the single
  // Chat-hosted panel surface (see CONTEXT.md "Activity panel"). Chat keeps the
  // selection derivation (useActivityPanel) and syncs its output into the
  // store; rows subscribe through per-row selectors instead of a controls
  // object threaded down the tree. The provider wires the scroll-anchoring
  // release on open (the panel module's own quirk).
  const [activityPanelStore] = useState(() => createActivityPanelStore())
  const activityPanelOpen = useActivityPanelOpen(activityPanelStore)
  const selectedActivityTurnId =
    useActivityPanelSelectedTurnId(activityPanelStore)
  const activityPanelId = useId()
  const {
    defaultActivityTurnId,
    panelActivityTurnId,
    selectedTurnPresent,
    panelProps,
  } = useActivityPanel({
    messages,
    status,
    isSubmitting,
    selectedActivityTurnId,
  })

  // The panel's open state and explicit selection belong to the chat they
  // were made in — navigating into a different chat must not carry them over.
  // The null → id transition is this same conversation acquiring its route on
  // first send (mirrors use-chat-core's chat-transition rule), so the panel
  // survives that handoff.
  const panelResetChatIdRef = useRef(chatId)
  useBrowserLayoutEffect(() => {
    const previousChatId = panelResetChatIdRef.current
    panelResetChatIdRef.current = chatId
    if (previousChatId === chatId || previousChatId === null) return
    activityPanelStore.setOpen(false)
  }, [chatId, activityPanelStore])

  // Sync the authoritative selection derivation into the store so row
  // subscriptions (trigger aria-expanded) follow branch switches and
  // generation handoffs — not only explicit trigger clicks. A LAYOUT effect
  // deliberately: a passive effect leaves one painted frame where triggers
  // report the previous panel turn, and a click landing in that frame would
  // be classified against a stale default — the misclassification this store
  // exists to prevent.
  useBrowserLayoutEffect(() => {
    activityPanelStore.setDerivedTurnIds({
      panelTurnId: panelActivityTurnId,
      defaultTurnId: defaultActivityTurnId,
    })
    // An explicit selection whose turn left the rendered path (branch switch,
    // local delete) is dropped so it cannot resurrect on a later path change.
    // The store re-checks the id at call time, so a newer selection made
    // after this render is never clobbered.
    if (selectedActivityTurnId !== undefined && !selectedTurnPresent) {
      activityPanelStore.clearStaleSelection(selectedActivityTurnId)
    }
  }, [
    activityPanelStore,
    panelActivityTurnId,
    defaultActivityTurnId,
    selectedActivityTurnId,
    selectedTurnPresent,
  ])

  const handleActivityPanelOpenChange = useCallback(
    (open: boolean) => activityPanelStore.setOpen(open),
    [activityPanelStore]
  )

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
  useEffect(() => {
    focusTextareaRef.current = () => composerRef.current?.focus()
    return () => {
      focusTextareaRef.current = null
    }
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
      handleQuotedSelected,
      selectMessageBranch,
      isDurableChat,
      lastFinishReason,
      handleToolApproval,
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
      !isChatLoading && // wait for the out-of-window getById fallback to resolve
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
    isChatLoading,
    currentChat,
    isSubmitting,
    status,
    messages.length,
    hasSentFirstMessage,
    router,
  ])

  const showOnboarding = !chatId && messages.length === 0

  return (
    <ActivityPanelStoreProvider
      store={activityPanelStore}
      panelId={activityPanelId}
    >
      <div id="thread" className="group/thread flex min-h-full flex-1 flex-col">
        <ChatStatusAnnouncer status={status} isSubmitting={isSubmitting} />
        <DialogAuth open={hasDialogAuth} setOpen={setHasDialogAuth} />

        <ActivityPanel
          panelId={activityPanelId}
          open={activityPanelOpen}
          onOpenChange={handleActivityPanelOpenChange}
          {...panelProps}
        />

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
              `group/thread-bottom-container sticky bottom-0 isolate z-10 flex min-h-0 w-full basis-auto flex-col px-[var(--thread-content-margin,1rem)] pb-[env(safe-area-inset-bottom,0px)] ${THREAD_GUTTER_VARS}`,
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
              className={`mx-auto w-full max-w-[var(--thread-content-max-width,40rem)] ${THREAD_MAXWIDTH_VARS}`}
            >
              <Composer
                ref={composerRef}
                chatId={chatId}
                onTurn={submit}
                onSuggestion={handleSuggestion}
                isSubmitting={isSubmitting}
                status={status}
                stop={stop}
                hasSuggestions={
                  preferences.promptSuggestions &&
                  !chatId &&
                  messages.length === 0
                }
                onLockedGuestModelSelect={() => setHasDialogAuth(true)}
              />
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
    </ActivityPanelStoreProvider>
  )
}
