import {
  deriveAssistantTurnView,
  type AssistantTurnView,
} from "@/lib/chat-messages/assistant-turn"
import { resolveTurnBranch } from "@/lib/chat-messages/branch"
import {
  isDurableMessageStatus,
  type DurableMessageStatus,
} from "@/lib/chat-messages/durable-contract"
import { getFinishReason } from "@/lib/chat-messages/metadata"
import { extractTextFromMessageParts } from "@/lib/chat-messages/parts"
import type { TurnRowModel } from "@/lib/chat-messages/turn-row"
import type { EditTurnResult } from "@/lib/chat-turn/chat-turn-controller"
import { cn } from "@/lib/utils"
import { UIMessage as MessageType } from "@ai-sdk/react"
import type { ReactNode } from "react"
import {
  ConversationTimestamp,
  deriveConversationTimestampHeaders,
} from "./conversation-timestamp"
import { Message } from "./message"
import {
  THREAD_GUTTER_VARS,
  THREAD_MAXWIDTH_VARS,
  TURN_SCROLL_MARGIN_BOTTOM,
} from "./thread-bounds"
import { ThreadScrollEdge } from "./thread-scroll"
import {
  isGenerationActive,
  PENDING_ACTIVITY_TURN_ID,
} from "./use-activity-panel"

type MessageRenderStatus = DurableMessageStatus | "ready" | "error"

type ConversationMessage = MessageType & {
  createdAt?: Date
}

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
  dataTestId,
  children,
}: {
  as?: "article" | "div"
  className: string
  dataTurn: string
  dataTurnId?: string
  dataTestId?: string
  children: ReactNode
}) {
  return (
    <As
      className={className}
      data-turn={dataTurn}
      data-turn-id={dataTurnId}
      data-testid={dataTestId}
    >
      <div
        className={`group/turn-messages relative mx-auto flex w-full max-w-[var(--thread-content-max-width,40rem)] min-w-0 flex-1 flex-col ${THREAD_MAXWIDTH_VARS}`}
      >
        {children}
      </div>
    </As>
  )
}

type ConversationProps = {
  messages: ConversationMessage[]
  /** Stable observation time for one render; injectable by deterministic
   * lifecycle tests without mocking the global clock. */
  now?: Date
  status?: "streaming" | "ready" | "submitted" | "error"
  isSubmitting?: boolean
  /** Scopes the scroll lifecycle (load restore, pinning) to one conversation. */
  chatId?: string | null
  /** True when this conversation was started in this session — the scroll
   * position came from send-time pinning, so the load restore must not run. */
  hasSentFirstMessage?: boolean
  onEdit: (
    id: string,
    newText: string
  ) => Promise<EditTurnResult | void> | EditTurnResult | void
  onReload: (messageId: string) => void
  retryModelId?: string
  onQuote?: (text: string, messageId: string) => void
  onSelectBranch?: (messageId: string) => void
  isDurableChat?: boolean
  lastFinishReason?: string
}

/** The pending placeholder's view: no parts yet, generation submitted. Module
 * constant so its metadata identity is stable across renders (memo-friendly). */
const PENDING_TURN_VIEW: AssistantTurnView = deriveAssistantTurnView(
  { parts: [] },
  "submitted"
)

export function Conversation({
  messages,
  now = new Date(),
  status = "ready",
  isSubmitting = false,
  chatId = null,
  hasSentFirstMessage = false,
  onEdit,
  onReload,
  retryModelId,
  onQuote,
  onSelectBranch,
  isDurableChat,
  lastFinishReason,
}: ConversationProps) {
  if (!messages || messages.length === 0)
    return <div className="w-full flex-1"></div>

  const generationActive = isGenerationActive(status, isSubmitting)
  const lastMessage = messages[messages.length - 1]
  const previousMessage = messages[messages.length - 2]
  const hasPendingAssistantTurn =
    generationActive && lastMessage?.role === "user"
  // Pin the active user turn as soon as its optimistic row is rendered. The
  // pending assistant row and response gutter already exist at that point, so
  // scrollIntoView can reserve the response area before first text arrives.
  // Once the assistant row replaces the pending row, keep the same user target;
  // ThreadScrollEdge deduplicates the pin for the rest of the active turn.
  // Branch switches and load hydration never satisfy this (no active turn), so
  // they never scroll.
  const pinTurnId =
    !generationActive
      ? null
      : lastMessage?.role === "user"
        ? lastMessage.id
        : lastMessage?.role === "assistant" &&
            previousMessage?.role === "user"
          ? previousMessage.id
          : null
  const timestampHeaders = deriveConversationTimestampHeaders(messages, now)

  return (
    <div className="relative -mb-(--composer-overlap-px) flex w-full grow basis-auto flex-col pb-(--composer-overlap-px) [--composer-overlap-px:28px]">
      <div className="flex w-full flex-col text-sm">
        {messages?.map((message, index) => {
          const isLast =
            index === messages.length - 1 &&
            !hasPendingAssistantTurn &&
            status !== "submitted"
          // The reference reserves the 40px turn tail on the LAST turn only; settled
          // older turns end at their action row (verified live 2026-07-11).
          const isLastTurnRow =
            index === messages.length - 1 && !hasPendingAssistantTurn
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

          let rowModel: TurnRowModel
          if (message.role === "assistant") {
            // The single per-render derivation of everything the assistant row
            // renders (see CONTEXT.md "Assistant turn view"). Derived fresh each
            // render — the AI SDK mutates part objects in place during streaming,
            // so this must never be memoized by message reference.
            const view = deriveAssistantTurnView(
              message,
              isLast ? status : "ready"
            )

            rowModel = {
              kind: "assistant",
              id: message.id,
              text: view.text,
              view,
              isLast,
              retryModelId,
              status: messageStatus,
              isDurableChat,
              finishReason:
                getFinishReason(message.metadata) ??
                (isLast ? lastFinishReason : undefined),
            }
          } else if (message.role === "user") {
            rowModel = {
              kind: "user",
              id: message.id,
              text: getMessageText(message),
              attachments: getMessageAttachments(message),
              branch: turnBranch,
              isDurableChat,
            }
          } else {
            rowModel = {
              kind: "unsupported",
              id: message.id,
              text: getMessageText(message),
              isDurableChat,
            }
          }

          const messageContent = (
            <Message
              model={rowModel}
              onEdit={onEdit}
              onReload={generationActive ? undefined : onReload}
              onSelectBranch={onSelectBranch}
              onQuote={onQuote}
            />
          )

          const timestampHeader = timestampHeaders[index]

          return (
            <div
              key={message.id}
              className="w-full"
              data-turn-id-container={message.id}
            >
              {timestampHeader && (
                <ConversationTimestamp header={timestampHeader} now={now} />
              )}
              <TurnRow
                className={cn(
                  `mx-auto w-full px-[var(--thread-content-margin,1rem)] text-base ${THREAD_GUTTER_VARS}`,
                  TURN_SCROLL_MARGIN_BOTTOM,
                  isUser &&
                    "scroll-mt-[var(--sticky-padding-top,var(--spacing-app-header))]",
                  isAssistant &&
                    "scroll-mt-[calc(var(--header-height)+min(200px,max(70px,20svh)))]",
                  // Only the thread's FIRST turn is padded (pt-3); later
                  // user turns get their spacing from the preceding action
                  // row / timestamp (verified live 2026-07-11).
                  index === 0 && "pt-3",
                  isLastTurnRow && "pb-10"
                )}
                dataTurn={message.role}
                dataTurnId={message.id}
                dataTestId={`conversation-turn-${index + 1}`}
              >
                {messageContent}
              </TurnRow>
            </div>
          )
        })}
        {hasPendingAssistantTurn && (
          <TurnRow
            as="div"
            className={cn(
              `mx-auto w-full scroll-mt-[calc(var(--header-height)+min(200px,max(70px,20svh)))] px-[var(--thread-content-margin,1rem)] pb-10 text-base ${THREAD_GUTTER_VARS}`,
              TURN_SCROLL_MARGIN_BOTTOM
            )}
            dataTurn="assistant"
            dataTurnId={PENDING_ACTIVITY_TURN_ID}
            dataTestId={`conversation-turn-${messages.length + 1}`}
          >
            <Message
              model={{
                kind: "assistant",
                id: PENDING_ACTIVITY_TURN_ID,
                text: "",
                isLast: true,
                view: PENDING_TURN_VIEW,
                retryModelId,
                status: "submitted",
                isDurableChat,
              }}
              onEdit={onEdit}
              onReload={undefined}
              onSelectBranch={onSelectBranch}
              onQuote={onQuote}
            />
          </TurnRow>
        )}
        <ThreadScrollEdge
          chatId={chatId}
          streamActive={generationActive}
          pinTurnId={pinTurnId}
          hydrated={messages.length > 0}
          freshChat={hasSentFirstMessage}
        />
      </div>
    </div>
  )
}
