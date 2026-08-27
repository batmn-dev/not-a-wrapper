"use client"

import {
  Composer,
  type ComposerHandle,
} from "@/app/components/chat-input/composer"
import { Conversation } from "@/app/components/chat/conversation"
import { useBrowserLayoutEffect } from "@/app/hooks/use-browser-layout-effect"
import { useGlobalPromptFocus } from "@/app/hooks/use-global-prompt-focus"
import type { Id } from "@/convex/_generated/dataModel"
import { useChats } from "@/lib/chat-store/chats/provider"
import { useChat } from "@/lib/chat-store/chats/use-chat"
import { useMessages } from "@/lib/chat-store/messages/provider"
import { useChatSession } from "@/lib/chat-store/session/provider"
import {
  useMarkChatReadOnView,
  usePublishActiveChatStatus,
} from "@/lib/chat-store/status/sidebar-chat-status"
import type { Chats } from "@/lib/chat-store/types"
import { isRouteDurableChat } from "@/lib/chat-turn/chat-turn-controller"
import { useUserPreferences } from "@/lib/user-preference-store/provider"
import { useUser } from "@/lib/user-store/provider"
import { cn } from "@/lib/utils"
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
import { resolveChatChrome } from "./chat-chrome"
import { useSetChatChrome } from "./chat-chrome-host"
import { ProjectChatDirectory } from "./project-chat-directory"
import { ProjectDetailSurface } from "./project-detail-surface"
import { ThreadBottomContainer } from "./thread-bottom-container"
import { TurnContextProvider, useTurnContext } from "./turn-context"
import { useActivityPanel } from "./use-activity-panel"
import { useChatCore } from "./use-chat-core"
import { useChatOperations } from "./use-chat-operations"

const DialogAuth = dynamic(
  () => import("./dialog-auth").then((mod) => mod.DialogAuth),
  { ssr: false }
)

/** Project context for the project surface — the Chat surface with a project
 * onboarding (name heading, project chat directory) whose first turn creates
 * its chat inside the project. */
export type ChatProjectContext = {
  id: Id<"projects">
  name: string
  pinned?: boolean
}

/**
 * Chat — resolves the route's chat and hosts the Turn context (model, search,
 * system prompt — the inputs every Chat turn snapshots at run time). The body
 * lives in ChatInner so its hooks read the context.
 *
 * With `project` set this is the project surface: the same first-turn pipeline
 * as home (chat committed atomically WITH its first user message by
 * `ensureChatExists` inside an ACCEPTED turn, then a shallow route handoff) —
 * never chat-creation before turn acceptance, which is what used to strand
 * empty project chats.
 */
export function Chat({ project }: { project?: ChatProjectContext }) {
  const { chatId } = useChatSession()
  // Resolve the current chat even when it is outside the bounded sidebar window
  // (deep-links to old chats). In-window chats resolve synchronously; out-of-
  // window chats load via the chats.getById fallback (isChatLoading).
  const { chat: currentChat, isLoading: isChatLoading } = useChat(chatId)

  return (
    <TurnContextProvider
      chatId={chatId}
      currentChat={currentChat || null}
      isChatLoading={isChatLoading}
    >
      <ChatInner
        chatId={chatId}
        currentChat={currentChat || null}
        isChatLoading={isChatLoading}
        project={project}
      />
    </TurnContextProvider>
  )
}

function ChatInner({
  chatId,
  currentChat,
  isChatLoading,
  project,
}: {
  chatId: string | null
  currentChat: Chats | null
  isChatLoading: boolean
  project?: ChatProjectContext
}) {
  const router = useRouter()
  const { navigateToChat } = useChatSession()
  const {
    createFirstTurnChat,
    bumpChat,
    isLoading: isChatsLoading,
  } = useChats()

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

  const [hasDialogAuth, setHasDialogAuth] = useState(false)
  // Edit and regeneration are server-owned Chat turns, available only on a
  // durable chat. Drives whether the message tree shows those controls so the
  // UI agrees with the turn-controller precondition. See CONTEXT.md "Chat turn".
  const isDurableChat = useMemo(
    () => isRouteDurableChat(chatId, isAuthenticated),
    [chatId, isAuthenticated]
  )
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

  const { checkLimitsAndNotify, ensureChatExists } = useChatOperations({
    isAuthenticated,
    chatId,
    selectedModel,
    systemPrompt,
    projectId: project?.id,
    createFirstTurnChat,
    navigateToChat,
    setHasDialogAuth,
  })

  // Core chat functionality (initialization + state + actions)
  const {
    messages,
    status,
    stop,
    presentation,
    hasSentFirstMessage,
    isSubmitting,
    lastFinishReason,
    scrollToMessageId,
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

  // Publish this (active) chat's live status to the sidebar so its row shows a
  // rotating ring while generating. Front-end seam #1 — cross-chat/background
  // status is projected onto the chat doc and derived per-row.
  usePublishActiveChatStatus(chatId, status)

  // The EFFECTIVE transport status every liveness-consuming surface renders:
  // a client-classified FRESH background run (another tab / re-entry — §8)
  // reads as streaming so conversation rows, the Activity panel, and the
  // announcer follow durable progress; a stale or terminal run never does —
  // the resolver's freshness bound is what keeps zombie loaders impossible.
  const effectiveStatus: typeof status =
    presentation.state === "background-streaming" ? "streaming" : status
  // Clear this chat's unread/error on open, and again when its backend terminal
  // mirror advances while viewing (a run you watched to completion counts as
  // read). Passes the active chat's mirror timestamp; no-op for guest/local ids.
  useMarkChatReadOnView(chatId, currentChat?.last_run_ended_at)

  // The Activity panel store — the seam assistant rows use to reach the single
  // Chat-hosted panel surface (see CONTEXT.md "Activity panel"). Chat keeps the
  // selection derivation (useActivityPanel) and syncs its output into the
  // store; rows subscribe through per-row selectors instead of a controls
  // object threaded down the tree.
  const [activityPanelStore] = useState(() => createActivityPanelStore())
  const activityPanelOpen = useActivityPanelOpen(activityPanelStore)
  const selectedActivityTurnId =
    useActivityPanelSelectedTurnId(activityPanelStore)
  const activityPanelId = useId()
  const {
    defaultActivityTurnId,
    panelActivityTurnId,
    defaultActivityDurationMs,
    defaultReasoningDurationMs,
    selectedTurnPresent,
    panelCanOpen,
    panelProps,
  } = useActivityPanel({
    messages,
    status: effectiveStatus,
    isSubmitting,
    isApprovalPaused: presentation.state === "awaiting-approval",
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
    activityPanelStore.setDerivedActivity({
      panelTurnId: panelActivityTurnId,
      defaultTurnId: defaultActivityTurnId,
      defaultDurationMs: defaultActivityDurationMs,
      defaultReasoningDurationMs,
    })
    // An explicit selection whose turn left the rendered path (branch switch,
    // local delete) is dropped so it cannot resurrect on a later path change.
    // The store re-checks the id at call time, so a newer selection made
    // after this render is never clobbered.
    if (selectedActivityTurnId !== undefined && !selectedTurnPresent) {
      activityPanelStore.clearStaleSelection(selectedActivityTurnId)
    }
    if (!panelCanOpen) activityPanelStore.setOpen(false)
  }, [
    activityPanelStore,
    panelActivityTurnId,
    defaultActivityTurnId,
    defaultActivityDurationMs,
    defaultReasoningDurationMs,
    selectedActivityTurnId,
    selectedTurnPresent,
    panelCanOpen,
  ])

  const handleActivityPanelOpenChange = useCallback(
    (open: boolean) => activityPanelStore.setOpen(open),
    [activityPanelStore]
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

  // The active turn's identity scopes announcement sources (the reference
  // announces with `conversation-turn-${turn.id}-…` ids). Mirrors the
  // assistant-turn row key: the turn is anchored on its user message.
  const lastAnnouncerMessage = messages[messages.length - 1]
  const previousAnnouncerMessage = messages[messages.length - 2]
  const announcerTurnId =
    lastAnnouncerMessage?.role === "user"
      ? `assistant-turn:${lastAnnouncerMessage.id}`
      : lastAnnouncerMessage?.role === "assistant" &&
          previousAnnouncerMessage?.role === "user"
        ? `assistant-turn:${previousAnnouncerMessage.id}`
        : (lastAnnouncerMessage?.id ?? null)

  // Memoize the conversation props to prevent unnecessary rerenders
  const conversationProps = useMemo(
    () => ({
      messages,
      status: effectiveStatus,
      isSubmitting,
      chatId,
      hasSentFirstMessage,
      onEdit: submitEdit,
      onReload: handleReload,
      retryModelId: selectedModel,
      onQuote: handleQuotedSelected,
      onSelectBranch: selectMessageBranch,
      isDurableChat,
      lastFinishReason,
      scrollToMessageId,
    }),
    [
      messages,
      effectiveStatus,
      isSubmitting,
      chatId,
      hasSentFirstMessage,
      submitEdit,
      handleReload,
      selectedModel,
      handleQuotedSelected,
      selectMessageBranch,
      isDurableChat,
      lastFinishReason,
      scrollToMessageId,
    ]
  )

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

  // The single chrome decision (ADR-0017): surface and header derive from one
  // resolver so a client-side flip can never show a thread without its header.
  const chrome = resolveChatChrome({
    chatId,
    messageCount: messages.length,
    hasProject: Boolean(project),
  })
  const showOnboarding = chrome.surface !== "thread"
  const projectOnboarding = chrome.surface === "project-onboarding"

  // Publish the header facts to the shell's pre-<main> slot (chat-chrome-host).
  // The header must stay OUTSIDE the main landmark for the skip link and
  // banner role; layout-effect timing keeps the flip in the same paint as the
  // surface swap. The route's initial values keep SSR and hydration aligned;
  // this publication selects the exact fixed mode before the first paint.
  const setChrome = useSetChatChrome()
  useBrowserLayoutEffect(() => {
    setChrome?.({
      appHeader: chrome.appHeader,
      fixedHeader: chrome.fixedHeader,
    })
  }, [setChrome, chrome.appHeader, chrome.fixedHeader])

  const projectComposerLabel = project
    ? `New chat in ${project.name}`
    : undefined
  const projectComposerPlaceholder =
    projectComposerLabel && projectComposerLabel.length > 54
      ? `${projectComposerLabel.slice(0, 53).trimEnd()}…`
      : projectComposerLabel
  const composer = (
    <Composer
      ref={composerRef}
      chatId={chatId}
      draftScopeId={project ? `project-${project.id}` : undefined}
      placeholder={projectComposerPlaceholder}
      ariaLabel={projectComposerLabel}
      bottomSpacing="none"
      onTurn={submit}
      onSuggestion={handleSuggestion}
      isSubmitting={isSubmitting}
      status={effectiveStatus}
      stop={stop}
      stoppable={presentation.stoppable}
      hasSuggestions={
        preferences.promptSuggestions &&
        !project &&
        !chatId &&
        messages.length === 0
      }
      onLockedGuestModelSelect={() => setHasDialogAuth(true)}
    />
  )

  return (
    <ActivityPanelStoreProvider
      store={activityPanelStore}
      panelId={activityPanelId}
    >
      <div
        id="thread"
        // `@container/thread` scopes cqw units to the SCROLL COLUMN (unlike
        // `@container/main`, which deliberately spans the activity dock — see
        // layout-app.tsx). The markdown table breakout (globals.css
        // `.markdown-table-container`) measures 100cqw against it, so tables
        // bleed to the thread edge and never under the docked panel. The named
        // `/main` tier queries pass through untouched.
        className="group/thread @container/thread flex min-h-full flex-1 flex-col"
        // The thread exposes its context-keep fraction as an
        // inline knob (theirs is React-set the same way; `.threadScrollVars`
        // consumes it with the same 1/3 fallback).
        style={{ "--thread-show-context-pct": "1/3" } as React.CSSProperties}
      >
        <ChatStatusAnnouncer
          status={effectiveStatus}
          isSubmitting={isSubmitting}
          presentationState={presentation.state}
          completionAvailable={lastFinishReason !== undefined}
          turnId={announcerTurnId}
        />
        <DialogAuth open={hasDialogAuth} setOpen={setHasDialogAuth} />

        <ActivityPanel
          panelId={activityPanelId}
          open={activityPanelOpen}
          onOpenChange={handleActivityPanelOpenChange}
          onToolApproval={handleToolApproval}
          {...panelProps}
        />

        {/* The Composer renders in ONE tree position (the ThreadBottomContainer
            slot below) across every onboarding↔thread flip. The optimistic
            insert flips these surfaces in the same frame as the send handoff,
            so a position swap here would remount the Composer mid-send —
            dropping its attachment previews, re-showing the sent text from the
            persisted draft, and losing focus. Only the content above and the
            slot's chrome variant may change. */}
        <div
          role="presentation"
          data-project-detail-surface={projectOnboarding ? "true" : undefined}
          className={cn(
            "composer-parent flex flex-1 flex-col focus-visible:outline-0",
            projectOnboarding &&
              "bg-background w-full [--project-detail-composer-width:48rem] [--project-detail-outer-width:51rem] [&_a]:transition-none [&_button]:transition-none"
          )}
        >
          {projectOnboarding && project ? (
            <ProjectDetailSurface
              project={project}
              onStartChat={() => composerRef.current?.focus()}
            />
          ) : showOnboarding ? (
            <div className="relative flex shrink basis-auto flex-col justify-end max-sm:grow max-sm:justify-center sm:min-h-[calc(42svh-var(--spacing-app-header))]">
              <div
                className="flex justify-center"
                data-splash-headline-option="WHATS_ON_YOUR_MIND"
              >
                <div className="hidden text-center [view-transition-name:var(--vt-splash-screen-headline)] sm:mb-[22px] sm:block">
                  <h1 className="inline-flex min-h-[42px] items-baseline px-1 text-2xl leading-9 font-normal text-balance">
                    What&apos;s on your mind?
                  </h1>
                </div>
                <div className="flex h-full w-full shrink flex-col items-center justify-center px-4 text-center [view-transition-name:var(--vt-splash-screen-headline)] sm:hidden">
                  <h1 className="inline-flex min-h-[42px] items-baseline px-1 text-2xl leading-9 font-normal text-balance">
                    What&apos;s on your mind?
                  </h1>
                </div>
              </div>
            </div>
          ) : (
            <Conversation {...conversationProps} />
          )}

          <ThreadBottomContainer surface={chrome.surface}>
            {composer}
          </ThreadBottomContainer>

          {projectOnboarding && project ? (
            <div className="flex-1 pb-[calc(7.5rem+env(safe-area-inset-bottom,0px))] md:pb-10">
              <ProjectChatDirectory projectId={project.id} />
            </div>
          ) : null}
        </div>
      </div>
    </ActivityPanelStoreProvider>
  )
}
