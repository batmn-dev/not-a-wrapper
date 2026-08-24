import { Icon } from "@/components/ui/icon"
import {
  Message,
  MessageActions,
  MessageContent,
} from "@/components/ui/message"
import { SystemMessage } from "@/components/ui/system-message"
import { TooltipMultiline } from "@/components/ui/tooltip"
import { deriveAssistantActivityPresentation } from "@/lib/chat-messages/assistant-activity"
import {
  deriveAssistantTurnPhase,
  hasPreservedResponseContent,
  type AssistantTurnView,
} from "@/lib/chat-messages/assistant-turn"
import type { DurableMessageStatus } from "@/lib/chat-messages/durable-contract"
import { getDurableError } from "@/lib/chat-messages/metadata"
import { getModelInfo } from "@/lib/models"
import { cn } from "@/lib/utils"
import { RiCheckLine, RiFileCopyLine, RiLoopRightLine } from "@remixicon/react"
import { useCallback } from "react"
import {
  useActivityPanelActions,
  useActivityPanelId,
  useDefaultActivityDurationMs,
  useDefaultReasoningDurationMs,
  useIsActivityPanelTurnOpen,
} from "./activity/activity-panel-store"
import { AssistantActivityIndicator } from "./assistant-activity-indicator"
import { MessageActionButton } from "./message-action-button"
import { QuoteButton } from "./quote-button"
import { SearchImages } from "./search-images"
import { SourcesBadge } from "./sources-badge"
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
  retryModelId?: string
  retryDisabled?: boolean
  status?: DurableMessageStatus | "ready" | "error"
  className?: string
  messageId: string
  onQuote?: (text: string, messageId: string) => void
  isDurableChat?: boolean
  finishReason?: string
}

export function MessageAssistant({
  children,
  view,
  isLast,
  copied,
  copyToClipboard,
  onReload,
  retryModelId,
  retryDisabled,
  status,
  className,
  messageId,
  onQuote,
  isDurableChat,
  finishReason,
}: MessageAssistantProps) {
  const { searchImageResults } = view
  // Regeneration is a server-owned Chat turn, available only on a durable
  // chat. Matches the turn-controller precondition. See CONTEXT.md "Chat turn".
  const canRegenerate = Boolean(onReload) && Boolean(isDurableChat)
  const retryModelName =
    getModelInfo(retryModelId ?? "")?.name ?? retryModelId ?? "selected model"

  const contentNullOrEmpty = children === null || children === ""
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
  const currentSessionDurationMs = useDefaultActivityDurationMs(
    messageId,
    view.serverMessageId
  )
  const currentSessionReasoningDurationMs = useDefaultReasoningDurationMs(
    messageId,
    view.serverMessageId
  )

  // The canonical phase feeds the normalized activity presentation. The row
  // renderer never inspects raw parts to choose label or interaction semantics.
  const phase = deriveAssistantTurnPhase(view, {
    status: status ?? "ready",
    isLast: isLast ?? false,
  })
  const activityPresentation = deriveAssistantActivityPresentation(
    view,
    phase,
    {
      workDurationMs: currentSessionDurationMs,
      reasoningDurationMs: currentSessionReasoningDurationMs,
      status: status ?? "ready",
    }
  )
  const turnActive = phase.kind !== "settled"
  const showMessageBody =
    searchImageResults.length > 0 ||
    hasContent ||
    (finishReason === "length" && status !== "streaming") ||
    status === "awaiting_approval" ||
    status === "aborted" ||
    status === "failed"
  const isBareThinkingStatus =
    activityPresentation.kind === "live-status" &&
    activityPresentation.semanticKind === "thinking"
  const showInlineBusyPlaceholder = isBareThinkingStatus && !showMessageBody
  const showMessageSlot = showMessageBody || showInlineBusyPlaceholder

  const { selectionInfo, clearSelection, messageRef } =
    useAssistantMessageSelection(true)
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

  const didStreamInSession = Boolean(isLast && finishReason)
  const copyableStatus =
    status !== "submitted" &&
    status !== "streaming" &&
    status !== "awaiting_approval"
  const showFooterActions = hasContent && copyableStatus

  return (
    <Message
      as="div"
      className={cn("flex max-w-full flex-col gap-0", className)}
      data-turn-phase={phase.kind}
    >
      <h4 className="sr-only">ChatGPT said:</h4>
      {/* Captured turn anatomy (box-chain verified 2026-07-14 and 2026-08-21):
          inspectable activity and the `text-message` block are gap-4 siblings.
          A bare Thinking placeholder instead occupies that same message slot,
          so first content replaces it without a vertical handoff. The action
          row mounts only after the response settles; message parts flow in a
          gap-1 column. */}
      <div className="flex max-w-full grow flex-col gap-4">
        {isBareThinkingStatus ? null : (
          <AssistantActivityIndicator
            presentation={activityPresentation}
            open={isPanelTurnOpen}
            onOpenChange={
              panelActions ? handleActivityTriggerOpenChange : undefined
            }
            controlsId={panelId}
          />
        )}

        {showMessageSlot ? (
          <div
            ref={messageRef}
            className="text-message relative flex min-h-8 w-full flex-col items-end gap-2 text-start break-words whitespace-normal outline-none"
            // Inner data-message-id for quote selection — closest() finds this before the outer section
            data-message-id={messageId}
            data-message-author-role="assistant"
            data-turn-start-message={
              isLast && !showInlineBusyPlaceholder ? "true" : undefined
            }
            dir="auto"
            tabIndex={isLast && !showInlineBusyPlaceholder ? 0 : undefined}
          >
            <div className="flex w-full flex-col gap-1 empty:hidden">
              {showInlineBusyPlaceholder ? (
                <AssistantActivityIndicator
                  presentation={activityPresentation}
                  open={false}
                />
              ) : null}

              {searchImageResults.length > 0 && (
                <SearchImages results={searchImageResults} />
              )}

              {contentNullOrEmpty ? null : (
                <MessageContent
                  className={cn(
                    "markdown prose relative w-full bg-transparent p-0",
                    status === "streaming" && "streaming-animation"
                  )}
                  markdown={true}
                  // Live render state for the Markdown block model (plan PR 3):
                  // only a live message's terminal block may render as a
                  // growing code block. Conversation already scopes live
                  // status to the last row, so no isLast gate is needed here.
                  streaming={status === "submitted" || status === "streaming"}
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
                          disabled: retryDisabled,
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
                          disabled: retryDisabled,
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
                          disabled: retryDisabled,
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
            </div>

            {selectionInfo && selectionInfo.messageId && (
              <QuoteButton
                container={selectionInfo.container}
                onQuote={handleQuoteBtnClick}
                range={selectionInfo.range}
              />
            )}
          </div>
        ) : null}
      </div>

      {showFooterActions && (
        <div className="relative z-0 flex min-h-[46px] justify-start">
          <MessageActions
            aria-label="Response actions"
            className={cn(
              "-ms-2.5 -me-1 -mt-1 w-[calc(100%+0.625rem)] flex-wrap items-center gap-0 gap-y-4 p-1 select-none",
              didStreamInSession && [
                "pointer-events-auto",
                "[mask-image:linear-gradient(to_right,black_33%,transparent_66%)]",
                "[mask-size:300%_100%]",
                "motion-safe:[animation:mask-reveal_1.5s_ease_forwards]",
                "motion-reduce:[mask-image:none]",
              ]
            )}
            role="group"
            tabIndex={-1}
          >
            {/* Branch nav lives on the user message (the turn anchor); see
                    conversation.tsx + message-user.tsx. Assistant messages
                    intentionally render no branch control. */}
            <MessageActionButton
              label="Copy response"
              tooltip={copied ? "Copied!" : "Copy Response"}
              onClick={copyToClipboard}
              icon={
                copied ? (
                  <Icon icon={RiCheckLine} slotSize={20} />
                ) : (
                  <Icon icon={RiFileCopyLine} slotSize={20} />
                )
              }
            />
            {canRegenerate ? (
              <MessageActionButton
                label={`Try again with ${retryModelName}`}
                tooltip={
                  <TooltipMultiline>
                    <span className="font-medium">Try again...</span>
                    <span className="text-[var(--text-tertiary)]">
                      Using {retryModelName}
                    </span>
                  </TooltipMultiline>
                }
                disabledReason={
                  retryDisabled
                    ? "Wait for the current response to finish."
                    : undefined
                }
                onClick={() => onReload?.(messageId)}
                icon={<Icon icon={RiLoopRightLine} slotSize={20} />}
              />
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
        </div>
      )}
    </Message>
  )
}
