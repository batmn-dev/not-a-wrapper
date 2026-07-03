import { ScrollRootContent } from "@/components/ui/scroll-root"
import {
  deriveAssistantTurnView,
  type AssistantTurnView,
} from "@/lib/chat-messages/assistant-turn"
import { resolveTurnBranch } from "@/lib/chat-messages/branch"
import {
  isDurableMessageStatus,
  type DurableMessageStatus,
} from "@/lib/chat-messages/durable-contract"
import { extractTextFromMessageParts } from "@/lib/chat-messages/parts"
import { cn } from "@/lib/utils"
import { UIMessage as MessageType } from "@ai-sdk/react"
import type { ReactNode } from "react"
import type { EditTurnResult } from "./chat-turn"
import { Message } from "./message"
import { THREAD_GUTTER_VARS, THREAD_MAXWIDTH_VARS } from "./thread-bounds"
import {
  isGenerationActive,
  PENDING_ACTIVITY_TURN_ID,
} from "./use-activity-panel"

type MessageRenderStatus = DurableMessageStatus | "ready" | "error"

function isMessageRenderStatus(value: unknown): value is MessageRenderStatus {
  return value === "ready" || value === "error" || isDurableMessageStatus(value)
}

// v6 helper: Extract text content from all text parts in order.
// Tool-enabled responses can interleave multiple assistant text parts across
// steps; using only the first part makes responses appear truncated.
function getMessageText(message: MessageType): string {
  return extractTextFromMessageParts(message.parts)
}

// Extract file attachments from parts array (user rows; assistant rows render
// no attachments)
function getMessageAttachments(
  message: MessageType
): Array<{ name: string; contentType: string; url: string }> | undefined {
  const fileParts = message.parts?.filter((p) => p.type === "file")
  if (!fileParts || fileParts.length === 0) return undefined
  return fileParts.map((p) => ({
    name: (p as { filename?: string }).filename || "file",
    contentType:
      (p as { mediaType?: string }).mediaType || "application/octet-stream",
    url: (p as { url?: string }).url || "",
  }))
}

/**
 * TurnRow — the shared turn wrapper for both the mapped message rows and the
 * pending-assistant placeholder: the thread-gutter container (`as` = article or
 * div) around the byte-identical `group/turn-messages` max-width column. The
 * outer `className` is composed per-branch (the two intentionally differ) and
 * applied verbatim; the inner column is owned here.
 */
function TurnRow({
  as: As = "article",
  className,
  dataTurn,
  dataTurnId,
  children,
}: {
  as?: "article" | "div"
  className: string
  dataTurn: string
  dataTurnId?: string
  children: ReactNode
}) {
  return (
    <As className={className} data-turn={dataTurn} data-turn-id={dataTurnId}>
      <div
        className={`group/turn-messages relative mx-auto flex w-full max-w-[var(--thread-content-max-width,40rem)] min-w-0 flex-1 flex-col ${THREAD_MAXWIDTH_VARS}`}
      >
        {children}
      </div>
    </As>
  )
}

type ConversationProps = {
  messages: MessageType[]
  status?: "streaming" | "ready" | "submitted" | "error"
  isSubmitting?: boolean
  onDelete: (id: string) => void
  onEdit: (
    id: string,
    newText: string
  ) => Promise<EditTurnResult | void> | EditTurnResult | void
  onReload: (messageId: string) => void
  onQuote?: (text: string, messageId: string) => void
  onSelectBranch?: (messageId: string) => void
  isDurableChat?: boolean
  lastFinishReason?: string
  onToolApproval?: (
    approvalId: string,
    approved: boolean,
    reason?: string
  ) => Promise<void> | void
}

/** The pending placeholder's view: no parts yet, generation submitted. Module
 * constant so its metadata identity is stable across renders (memo-friendly). */
const PENDING_TURN_VIEW: AssistantTurnView = deriveAssistantTurnView(
  { parts: [] },
  "submitted"
)

export function Conversation({
  messages,
  status = "ready",
  isSubmitting = false,
  onDelete,
  onEdit,
  onReload,
  onQuote,
  onSelectBranch,
  isDurableChat,
  lastFinishReason,
  onToolApproval,
}: ConversationProps) {
  if (!messages || messages.length === 0)
    return <div className="w-full flex-1"></div>

  const generationActive = isGenerationActive(status, isSubmitting)
  const hasPendingAssistantTurn =
    generationActive && messages[messages.length - 1]?.role === "user"

  return (
    <ScrollRootContent className="relative -mb-[var(--composer-overlap-px)] flex w-full flex-1 flex-col items-center pt-4 pb-[var(--thread-bottom-offset)] [--composer-overlap-px:28px] [--thread-bottom-offset:calc(var(--spacing-input-area)+env(safe-area-inset-bottom,0px))]">
      <div
        aria-hidden="true"
        data-edge="top"
        className="pointer-events-none absolute top-0 h-px w-px"
      />
      {messages?.map((message, index) => {
        const isLast =
          index === messages.length - 1 &&
          !hasPendingAssistantTurn &&
          status !== "submitted"
        const isAssistant = message.role === "assistant"
        const isUser = message.role === "user"

        // Branch nav always anchors on the user message (the turn): show the
        // user's own edit branch, or — when the prompt itself wasn't edited —
        // the response's regenerate branch. Assistant messages never render the
        // control; selecting a response sibling still works because the branch
        // descriptor carries the assistant sibling ids.
        const turnBranch = resolveTurnBranch(message, messages[index + 1])
        const durableStatus = (message as { status?: string }).status
        // Durable status wins only when it asserts a settled/paused OUTCOME
        // (aborted/failed/awaiting_approval). Durable LIVE statuses
        // (submitted/streaming) are deliberately ignored: after a Stop or a
        // dropped stream the server run can lag its terminal transition, and
        // adopting its stale "streaming" here resurrected live loaders on a
        // turn whose stream this client already knows is over. The client's
        // own stream status is authoritative for liveness on the last turn;
        // older turns always render settled.
        const messageStatus: MessageRenderStatus =
          isMessageRenderStatus(durableStatus) &&
          (durableStatus === "aborted" ||
            durableStatus === "failed" ||
            durableStatus === "awaiting_approval")
            ? durableStatus
            : isLast
              ? status
              : "ready"

        let messageContent: ReactNode
        if (message.role === "assistant") {
          // The single per-render derivation of everything the assistant row
          // renders (see CONTEXT.md "Assistant turn view"). Derived fresh each
          // render — the AI SDK mutates part objects in place during streaming,
          // so this must never be memoized by message reference.
          const view = deriveAssistantTurnView(
            message,
            isLast ? status : "ready"
          )

          messageContent = (
            <Message
              id={message.id}
              variant="assistant"
              isLast={isLast}
              view={view}
              onDelete={onDelete}
              onEdit={onEdit}
              onReload={generationActive ? undefined : onReload}
              onSelectBranch={onSelectBranch}
              branch={turnBranch}
              status={messageStatus}
              onQuote={onQuote}
              isDurableChat={isDurableChat}
              finishReason={isLast ? lastFinishReason : undefined}
              onToolApproval={onToolApproval}
            >
              {view.text}
            </Message>
          )
        } else {
          messageContent = (
            <Message
              id={message.id}
              variant={message.role}
              attachments={isUser ? getMessageAttachments(message) : undefined}
              isLast={isLast}
              onDelete={onDelete}
              onEdit={onEdit}
              onReload={generationActive ? undefined : onReload}
              onSelectBranch={onSelectBranch}
              branch={turnBranch}
              status={messageStatus}
              onQuote={onQuote}
              isDurableChat={isDurableChat}
              finishReason={isLast ? lastFinishReason : undefined}
              onToolApproval={onToolApproval}
            >
              {getMessageText(message)}
            </Message>
          )
        }

        return (
          <TurnRow
            key={message.id}
            className={cn(
              `mx-auto w-full px-[var(--thread-content-margin,1rem)] text-base ${THREAD_GUTTER_VARS}`,
              isUser &&
                "scroll-mt-[var(--sticky-padding-top,var(--spacing-app-header))] pt-3",
              isAssistant &&
                "scroll-mt-[calc(var(--sticky-padding-top,var(--spacing-app-header))+min(200px,max(70px,20svh)))] pb-10"
            )}
            dataTurn={message.role}
            dataTurnId={message.id}
          >
            {messageContent}
          </TurnRow>
        )
      })}
      {hasPendingAssistantTurn && (
        <TurnRow
          as="div"
          className={`mx-auto w-full scroll-mt-[calc(var(--sticky-padding-top,var(--spacing-app-header))+min(200px,max(70px,20svh)))] px-[var(--thread-content-margin,1rem)] pb-10 text-base ${THREAD_GUTTER_VARS}`}
          dataTurn="assistant"
          dataTurnId={PENDING_ACTIVITY_TURN_ID}
        >
          <Message
            id={PENDING_ACTIVITY_TURN_ID}
            variant="assistant"
            isLast
            view={PENDING_TURN_VIEW}
            onDelete={onDelete}
            onEdit={onEdit}
            onReload={undefined}
            onSelectBranch={onSelectBranch}
            status="submitted"
            onQuote={onQuote}
            isDurableChat={isDurableChat}
            onToolApproval={onToolApproval}
          >
            {""}
          </Message>
        </TurnRow>
      )}
      <div
        aria-hidden="true"
        data-edge="bottom"
        className="pointer-events-none absolute bottom-0 h-px w-px"
      />
    </ScrollRootContent>
  )
}
