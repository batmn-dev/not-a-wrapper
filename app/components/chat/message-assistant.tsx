import { Icon } from "@/components/ui/icon"
import {
  Loader,
  StreamingCaret,
  type StreamingIndicatorVariant,
} from "@/components/ui/loader"
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  messageFooterRevealClassName,
} from "@/components/ui/message"
import { SystemMessage } from "@/components/ui/system-message"
import {
  deriveAssistantLoadingState,
  type AssistantTurnView,
} from "@/lib/chat-messages/assistant-turn"
import type { DurableMessageStatus } from "@/lib/chat-messages/durable-contract"
import { useUserPreferences } from "@/lib/user-preference-store/provider"
import { cn } from "@/lib/utils"
import { RiCheckLine, RiFileCopyLine, RiRefreshLine } from "@remixicon/react"
import { useCallback, useRef, useState } from "react"
import {
  useActivityPanelActions,
  useActivityPanelId,
  useIsActivityPanelTurnOpen,
} from "./activity/activity-panel-store"
import {
  ActivityPanelTrigger,
  type ActivityTriggerState,
} from "./activity/activity-panel-trigger"
import { QuoteButton } from "./quote-button"
import { SearchImages } from "./search-images"
import { ToolInvocation } from "./tool-invocation"
import { useAssistantMessageSelection } from "./useAssistantMessageSelection"

type MessageAssistantProps = {
  children: string
  /** The Assistant turn view — the single derivation of everything this row
   * renders from the message's parts/metadata. See CONTEXT.md. */
  view: AssistantTurnView
  isLast?: boolean
  copied?: boolean
  copyToClipboard?: () => void
  onReload?: (messageId: string) => void
  status?: DurableMessageStatus | "ready" | "error"
  className?: string
  messageId: string
  onQuote?: (text: string, messageId: string) => void
  isDurableChat?: boolean
  finishReason?: string
  onToolApproval?: (
    approvalId: string,
    approved: boolean,
    reason?: string
  ) => Promise<void> | void
}

const STREAMING_INDICATOR_VARIANT: StreamingIndicatorVariant = "caret"

function formatToolProgressLabel(toolName: string): string {
  switch (toolName) {
    case "web_search":
    case "google_search":
      return "Searching the web"
    case "imageGeneration":
    case "image_generation":
      return "Generating image"
    default: {
      const readableName = toolName
        .replace(/_/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .trim()
      const normalized =
        readableName.length > 0
          ? readableName.charAt(0).toUpperCase() + readableName.slice(1)
          : "Running tool"
      return `Running ${normalized}`
    }
  }
}

export function MessageAssistant({
  children,
  view,
  isLast,
  copied,
  copyToClipboard,
  onReload,
  status,
  className,
  messageId,
  onQuote,
  isDurableChat,
  finishReason,
  onToolApproval,
}: MessageAssistantProps) {
  const { preferences } = useUserPreferences()
  const { sources, toolParts, searchImageResults, reasoning } = view
  // Regeneration is a server-owned Chat turn, available only on a durable
  // chat. Matches the turn-controller precondition. See CONTEXT.md "Chat turn".
  const canRegenerate = Boolean(onReload) && Boolean(isDurableChat)

  const contentNullOrEmpty = children === null || children === ""
  const isLastStreaming = status === "streaming" && isLast
  const isSubmittedPending = status === "submitted" && isLast
  const hasContent = !contentNullOrEmpty
  const loadingStatus: "streaming" | "ready" | "submitted" | "error" =
    status === "streaming" || status === "submitted" || status === "error"
      ? status
      : status === "failed"
        ? "error"
        : "ready"

  // Reasoning + sources live in the Chat-owned Activity panel. Each assistant
  // row with activity keeps its own trigger; only the row currently projected
  // into the panel reports aria-expanded=true. The row reaches the panel
  // through the activity panel store seam — no props thread through the tree.
  const panelActions = useActivityPanelActions()
  const panelId = useActivityPanelId()
  const isPanelTurnOpen = useIsActivityPanelTurnOpen(
    messageId,
    view.serverMessageId
  )
  const hasReasoningPart = reasoning.phase !== "idle"
  const isReasoningStreaming = reasoning.isStreaming
  const hasSources = sources.length > 0
  const hasToolActivity = toolParts.length > 0
  const showActivityTrigger =
    Boolean(panelActions) &&
    (isSubmittedPending ||
      isReasoningStreaming ||
      hasReasoningPart ||
      hasSources ||
      hasToolActivity)
  const reasoningDurationSeconds =
    reasoning.persistedDurationMs !== undefined
      ? Math.round(reasoning.persistedDurationMs / 1000)
      : undefined
  // Compose the trigger's thinking state: live "Thinking" while reasoning
  // streams, then "Thought for {duration}" once it completes, else a source
  // count or the generic label.
  const activityState: ActivityTriggerState =
    isSubmittedPending || isReasoningStreaming
      ? { status: "thinking" }
      : hasReasoningPart
        ? { status: "thought", durationSeconds: reasoningDurationSeconds }
        : hasSources
          ? { status: "sources", count: sources.length }
          : { status: "activity" }

  const {
    showDots: showStreamingLoader,
    showToolProgress,
    showImageGenProgress,
    activeToolNames,
  } = deriveAssistantLoadingState(view, {
    status: loadingStatus,
    isLast: isLast ?? false,
    contentNullOrEmpty,
    showToolInvocations: preferences.showToolInvocations,
  })

  const messageRef = useRef<HTMLDivElement>(null)
  const { selectionInfo, clearSelection } = useAssistantMessageSelection(
    messageRef,
    true
  )
  const handleQuoteBtnClick = useCallback(() => {
    if (selectionInfo && onQuote) {
      onQuote(selectionInfo.text, selectionInfo.messageId)
      clearSelection()
    }
  }, [selectionInfo, onQuote, clearSelection])
  const handleActivityTriggerOpenChange = useCallback(
    (open: boolean) => {
      if (!panelActions) return
      if (open) {
        panelActions.openTurn(messageId)
      } else {
        panelActions.close()
      }
    },
    [panelActions, messageId]
  )

  const [contentCaretPhase, setContentCaretPhase] = useState<
    "hidden" | "visible" | "fading"
  >("hidden")
  const showActiveContentCaret = Boolean(
    isLast && status === "streaming" && hasContent
  )

  const didStreamInSession = Boolean(isLast && finishReason)
  const showFooterCaret = hasContent && contentCaretPhase !== "hidden"
  const showFooterActions =
    hasContent &&
    !isLastStreaming &&
    (!isLast || contentCaretPhase === "hidden")
  const showFooterSlot = showFooterCaret || showFooterActions

  if (showActiveContentCaret && contentCaretPhase !== "visible") {
    setContentCaretPhase("visible")
  } else if (
    !showActiveContentCaret &&
    status === "ready" &&
    isLast &&
    contentCaretPhase === "visible"
  ) {
    setContentCaretPhase("fading")
  } else if (
    (!isLast ||
      !hasContent ||
      (status !== "streaming" && status !== "ready")) &&
    contentCaretPhase !== "hidden"
  ) {
    setContentCaretPhase("hidden")
  }

  return (
    <Message
      as="div"
      className={cn("flex w-full flex-col gap-2", className)}
      data-turn="assistant"
      data-message-id={messageId}
      data-message-author-role="assistant"
      data-scroll-anchor={isLast ? "true" : "false"}
      tabIndex={-1}
    >
      <h6 className="sr-only">Assistant said:</h6>
      <div
        ref={messageRef}
        className={cn(
          "relative flex min-w-full flex-col gap-2",
          isLast && "pb-8"
        )}
        // Inner data-message-id for quote selection — closest() finds this before the outer article
        data-message-id={messageId}
      >
        {toolParts.length > 0 && preferences.showToolInvocations && (
          <ToolInvocation
            toolInvocations={toolParts}
            metadata={view.metadata}
            onToolApproval={onToolApproval}
          />
        )}

        {showToolProgress && (
          <Loader
            variant="loading-dots"
            text={
              activeToolNames.length === 1
                ? formatToolProgressLabel(activeToolNames[0])
                : "Running tools"
            }
          />
        )}

        {searchImageResults.length > 0 && (
          <SearchImages results={searchImageResults} />
        )}

        {showImageGenProgress && (
          <Loader variant="loading-dots" text="Generating image" />
        )}

        {showStreamingLoader && (
          <Loader
            variant="text-shimmer"
            text="Generating"
            showCaret
            streamingIndicatorVariant={STREAMING_INDICATOR_VARIANT}
          />
        )}

        {showActivityTrigger && panelActions && (
          <div className="flex items-center justify-between">
            <div className="flex min-w-0 items-center">
              <ActivityPanelTrigger
                open={isPanelTurnOpen}
                onOpenChange={handleActivityTriggerOpenChange}
                controlsId={panelId}
                state={activityState}
              />
            </div>
          </div>
        )}

        {contentNullOrEmpty ? null : (
          <MessageContent
            className={cn(
              "prose relative min-w-full bg-transparent p-0",
              "prose-h1:scroll-m-20 prose-h1:text-2xl prose-h1:font-semibold prose-h2:mt-8 prose-h2:scroll-m-20 prose-h2:text-xl prose-h2:mb-3 prose-h2:font-medium prose-h3:scroll-m-20 prose-h3:text-base prose-h3:font-medium prose-h4:scroll-m-20 prose-h5:scroll-m-20 prose-h6:scroll-m-20 prose-strong:font-medium prose-table:block prose-table:overflow-y-auto"
            )}
            markdown={true}
          >
            {children}
          </MessageContent>
        )}

        {finishReason === "length" && status !== "streaming" && (
          <SystemMessage
            variant="warning"
            fill
            cta={
              canRegenerate
                ? {
                    label: "Regenerate",
                    onClick: () => onReload?.(messageId),
                  }
                : undefined
            }
          >
            Response may be incomplete due to output length limits.
          </SystemMessage>
        )}

        {status === "awaiting_approval" && (
          <SystemMessage variant="action" fill>
            Waiting for approval before running the tool.
          </SystemMessage>
        )}

        {status === "aborted" && (
          <SystemMessage variant="warning" fill>
            Generation stopped. Partial response preserved.
          </SystemMessage>
        )}

        {status === "failed" && (
          <SystemMessage variant="error" fill>
            Generation failed. Partial response preserved.
          </SystemMessage>
        )}

        {showFooterSlot && (
          <div className="relative min-h-8 pointer-coarse:min-h-10">
            {showFooterCaret && (
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center">
                <StreamingCaret
                  visible={contentCaretPhase === "visible"}
                  variant={STREAMING_INDICATOR_VARIANT}
                  className="ml-px"
                  onFadeOutComplete={() => setContentCaretPhase("hidden")}
                />
              </div>
            )}

            {showFooterActions && (
              <MessageActions
                className={cn(
                  "-ml-2 min-h-8 gap-0 pointer-coarse:min-h-10",
                  didStreamInSession
                    ? [
                        "pointer-events-auto",
                        "[mask-image:linear-gradient(to_right,black_33%,transparent_66%)]",
                        "[mask-size:300%_100%]",
                        "motion-safe:[animation:mask-reveal_1.5s_ease_forwards]",
                        "motion-reduce:[mask-image:none]",
                      ]
                    : // Shared hover reveal — identical to the user footer.
                      messageFooterRevealClassName
                )}
              >
                {/* Branch nav lives on the user message (the turn anchor); see
                    conversation.tsx + message-user.tsx. Assistant messages
                    intentionally render no branch control. */}
                <MessageAction
                  tooltip={copied ? "Copied!" : "Copy text"}
                  side="bottom"
                >
                  <button
                    className="text-muted-foreground flex h-8 w-8 items-center justify-center rounded-md bg-transparent pointer-coarse:h-10 pointer-coarse:w-10"
                    aria-label="Copy text"
                    onClick={copyToClipboard}
                    type="button"
                  >
                    {copied ? (
                      <Icon icon={RiCheckLine} slotSize={20} />
                    ) : (
                      <Icon icon={RiFileCopyLine} slotSize={20} />
                    )}
                  </button>
                </MessageAction>
                {canRegenerate ? (
                  <MessageAction tooltip="Regenerate" side="bottom" delay={0}>
                    <button
                      className="text-muted-foreground flex h-8 w-8 items-center justify-center rounded-md bg-transparent pointer-coarse:h-10 pointer-coarse:w-10"
                      aria-label="Regenerate"
                      onClick={() => onReload?.(messageId)}
                      type="button"
                    >
                      <Icon icon={RiRefreshLine} slotSize={20} />
                    </button>
                  </MessageAction>
                ) : null}
              </MessageActions>
            )}
          </div>
        )}

        {selectionInfo && selectionInfo.messageId && (
          <QuoteButton
            mousePosition={selectionInfo.position}
            onQuote={handleQuoteBtnClick}
            messageContainerRef={messageRef}
            onDismiss={clearSelection}
          />
        )}
      </div>
    </Message>
  )
}
