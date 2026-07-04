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
  deriveAssistantTurnIndicator,
  deriveAssistantTurnPhase,
  hasPreservedResponseContent,
  type AssistantTurnView,
} from "@/lib/chat-messages/assistant-turn"
import type { DurableMessageStatus } from "@/lib/chat-messages/durable-contract"
import { getDurableError } from "@/lib/chat-messages/metadata"
import { useUserPreferences } from "@/lib/user-preference-store/provider"
import { cn } from "@/lib/utils"
import { RiCheckLine, RiFileCopyLine, RiRefreshLine } from "@remixicon/react"
import { useCallback, useRef, useState } from "react"
import {
  useActivityPanelActions,
  useActivityPanelId,
  useIsActivityPanelTurnOpen,
} from "./activity/activity-panel-store"
import { ActivityPanelTrigger } from "./activity/activity-panel-trigger"
import { QuoteButton } from "./quote-button"
import { SearchImages } from "./search-images"
import { SourcesBadge } from "./sources-badge"
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
  const { toolParts, searchImageResults } = view
  // Regeneration is a server-owned Chat turn, available only on a durable
  // chat. Matches the turn-controller precondition. See CONTEXT.md "Chat turn".
  const canRegenerate = Boolean(onReload) && Boolean(isDurableChat)

  const contentNullOrEmpty = children === null || children === ""
  const isLastStreaming = status === "streaming" && isLast
  const hasContent = !contentNullOrEmpty
  // Durable terminal-state presentation inputs: whether any visible response
  // content survived, and the persisted error summary for failed turns.
  const preservedResponse = hasPreservedResponseContent(view)
  const durableError = getDurableError(view.metadata)

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

  // The canonical turn phase and its single indicator — every loading
  // affordance on this row is a presentation of `phase`. See CONTEXT.md
  // "Assistant turn view" and the derivation in lib/chat-messages.
  const phase = deriveAssistantTurnPhase(view, {
    status: status ?? "ready",
    isLast: isLast ?? false,
  })
  const indicator = deriveAssistantTurnIndicator(phase, view)
  const turnActive = phase.kind !== "settled"

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
  // The sources badge is a navigate-to affordance, not a disclosure: it always
  // opens/projects this turn with the Sources section in view (re-clicking
  // while open re-scrolls to sources rather than closing — closing stays on
  // the activity trigger and the panel's own close affordances).
  const handleSourcesBadgeOpen = useCallback(() => {
    panelActions?.openTurn(messageId, { section: "sources" })
  }, [panelActions, messageId])

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
      data-turn-phase={phase.kind}
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
            turnActive={turnActive}
            onToolApproval={onToolApproval}
          />
        )}

        {searchImageResults.length > 0 && (
          <SearchImages results={searchImageResults} />
        )}

        {/* The single indicator slot — renders the one presentation of the
            turn phase. Mutually exclusive by construction: `indicator` is a
            single discriminated value, so this slot can never stack a loader
            under a live trigger the way the old per-affordance gates could. */}
        {indicator.kind === "generating" && (
          <Loader
            variant="text-shimmer"
            text="Generating"
            showCaret
            streamingIndicatorVariant={STREAMING_INDICATOR_VARIANT}
          />
        )}

        {indicator.kind === "trigger" && panelActions && (
          <div className="flex items-center justify-between">
            <div className="flex min-w-0 items-center">
              <ActivityPanelTrigger
                open={isPanelTurnOpen}
                onOpenChange={handleActivityTriggerOpenChange}
                controlsId={panelId}
                state={indicator.state}
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

        {/* Terminal aborted/failed states are durable data (the message row's
            status + error), not transient client state: a turn that died
            before producing content renders as a first-class stub with a
            retry (regeneration) affordance instead of vanishing behind a
            toast. Retry re-runs the turn against the same user message. The
            banner hosts Retry exactly when the text footer (which carries the
            regenerate action) is absent — gate on text, not on preserved
            content, so tool-only turns keep a retry control. */}
        {status === "aborted" && (
          <SystemMessage
            variant="warning"
            fill
            cta={
              !hasContent && canRegenerate
                ? {
                    label: "Retry",
                    onClick: () => onReload?.(messageId),
                  }
                : undefined
            }
          >
            {preservedResponse
              ? "Generation stopped. Partial response preserved."
              : "Generation stopped."}
          </SystemMessage>
        )}

        {status === "failed" && (
          <SystemMessage
            variant="error"
            fill
            cta={
              canRegenerate
                ? {
                    label: "Retry",
                    onClick: () => onReload?.(messageId),
                  }
                : undefined
            }
          >
            {durableError
              ? `Generation failed: ${durableError}`
              : "Generation failed."}
            {preservedResponse ? " Partial response preserved." : ""}
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
                {/* Trailing sources badge (reference: last child of the
                    response-actions row). Settled turns only — while the turn
                    is live, source deltas stay panel-owned and this row's memo
                    deliberately ignores them; the settle re-render (status
                    flip / metadata adoption) is what reveals the badge with
                    the final deduped sources. */}
                {!turnActive && panelActions && (
                  <SourcesBadge
                    sources={view.sources}
                    open={isPanelTurnOpen}
                    onOpen={handleSourcesBadgeOpen}
                    controlsId={panelId}
                  />
                )}
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
