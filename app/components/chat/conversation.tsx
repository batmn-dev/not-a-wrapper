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
import { Fragment, type ReactNode } from "react"
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
  shouldRenderPendingAssistantTurn,
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
 * TurnRow — the stable section wrapper shared by mapped messages and the
 * pending-assistant placeholder. Pending and real assistant content reconcile
 * through this same DOM node; only its data identity and contents update.
 */
function TurnRow({
  className,
  dataTurn,
  dataTurnId,
  dataTestId,
  children,
}: {
  className: string
  dataTurn: string
  dataTurnId?: string
  dataTestId?: string
  children: ReactNode
}) {
  return (
    <section
      className={className}
      data-turn-id-container={dataTurnId}
      data-turn={dataTurn}
      data-turn-id={dataTurnId}
      data-testid={dataTestId}
      dir="auto"
    >
      <div
        className={`group/turn-messages relative mx-auto flex w-full max-w-[var(--thread-content-max-width,40rem)] min-w-0 flex-1 flex-col ${THREAD_MAXWIDTH_VARS}`}
      >
        {children}
      </div>
    </section>
  )
}

type ConversationRenderRow =
  | {
      kind: "message"
      key: string
      message: ConversationMessage
      index: number
    }
  | { kind: "pending"; key: string; index: number }

function assistantTurnRowKey(userMessageId: string): string {
  return `assistant-turn:${userMessageId}`
}

function messageTurnRowKey(
  messages: ConversationMessage[],
  index: number
): string {
  const message = messages[index]
  const previousMessage = messages[index - 1]

  if (message.role === "assistant" && previousMessage?.role === "user") {
    return assistantTurnRowKey(previousMessage.id)
  }

  return `message:${message.id}`
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
  const hasPendingAssistantTurn = shouldRenderPendingAssistantTurn({
    messages,
    status,
    isSubmitting,
  })
  // Persistence can insert the real assistant shell before its first stream
  // part. Keep that empty shell out of the rendered path so the pending row
  // remains the single 32px owner until content can replace it atomically.
  const renderedMessages =
    hasPendingAssistantTurn && lastMessage?.role === "assistant"
      ? messages.slice(0, -1)
      : messages
  // Pin the active user turn as soon as its optimistic row is rendered. The
  // pending assistant row and response gutter already exist at that point, so
  // scrollIntoView can reserve the response area before first text arrives.
  // Once the assistant row replaces the pending row, keep the same user target;
  // ThreadScrollEdge deduplicates the pin for the rest of the active turn.
  // Branch switches and load hydration never satisfy this (no active turn), so
  // they never scroll.
  const pinTurnId = !generationActive
    ? null
    : lastMessage?.role === "user"
      ? lastMessage.id
      : lastMessage?.role === "assistant" && previousMessage?.role === "user"
        ? previousMessage.id
        : null
  const timestampHeaders = deriveConversationTimestampHeaders(
    renderedMessages,
    now
  )
  const renderRows: ConversationRenderRow[] = renderedMessages.map(
    (message, index) => ({
      kind: "message",
      key: messageTurnRowKey(renderedMessages, index),
      message,
      index,
    })
  )

  if (hasPendingAssistantTurn) {
    const activeUserMessage =
      lastMessage?.role === "user"
        ? lastMessage
        : lastMessage?.role === "assistant" && previousMessage?.role === "user"
          ? previousMessage
          : undefined

    renderRows.push({
      kind: "pending",
      key: assistantTurnRowKey(
        activeUserMessage?.id ?? PENDING_ACTIVITY_TURN_ID
      ),
      index: renderedMessages.length,
    })
  }

  return (
    <div className="relative -mb-(--composer-overlap-px) flex w-full grow basis-auto flex-col pb-(--composer-overlap-px) [--composer-overlap-px:28px]">
      <div className="flex w-full flex-col text-sm">
        {renderRows.map((row) => {
          if (row.kind === "pending") {
            return (
              <Fragment key={row.key}>
                <TurnRow
                  key="turn"
                  className={cn(
                    `mx-auto w-full scroll-mt-[calc(var(--header-height)+min(200px,max(70px,20svh)))] px-[var(--thread-content-margin,1rem)] pb-8 text-base ${THREAD_GUTTER_VARS}`,
                    TURN_SCROLL_MARGIN_BOTTOM,
                    row.index === 0 && "pt-3"
                  )}
                  dataTurn="assistant"
                  dataTurnId={PENDING_ACTIVITY_TURN_ID}
                  dataTestId={`conversation-turn-${row.index + 1}`}
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
              </Fragment>
            )
          }

          const { message, index } = row
          const isLast =
            index === renderedMessages.length - 1 &&
            !hasPendingAssistantTurn &&
            status !== "submitted"
          // The reference reserves the 32px turn tail on the LAST turn only; settled
          // older turns end at their action row (verified live 2026-07-11).
          const isLastTurnRow =
            index === renderedMessages.length - 1 && !hasPendingAssistantTurn
          const isAssistant = message.role === "assistant"
          const isUser = message.role === "user"

          // Branch nav always anchors on the user message (the turn): show the
          // user's own edit branch, or — when the prompt itself wasn't edited —
          // the response's regenerate branch. Assistant messages never render the
          // control; selecting a response sibling still works because the branch
          // descriptor carries the assistant sibling ids.
          const turnBranch = resolveTurnBranch(
            message,
            renderedMessages[index + 1]
          )
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
              retryDisabled: generationActive,
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
              onReload={onReload}
              onSelectBranch={onSelectBranch}
              onQuote={onQuote}
            />
          )

          const timestampHeader = timestampHeaders[index]

          return (
            <Fragment key={row.key}>
              {timestampHeader && (
                <ConversationTimestamp header={timestampHeader} now={now} />
              )}
              <TurnRow
                key="turn"
                className={cn(
                  `mx-auto w-full px-[var(--thread-content-margin,1rem)] text-base ${THREAD_GUTTER_VARS}`,
                  TURN_SCROLL_MARGIN_BOTTOM,
                  isUser &&
                    "scroll-mt-[var(--sticky-padding-top,var(--spacing-app-header))]",
                  isAssistant &&
                    "scroll-mt-[calc(var(--header-height)+min(200px,max(70px,20svh)))]",
                  // ChatGPT keeps the first turn 12px from the thread edge and
                  // gives every later user prompt a 48px inter-turn lead-in.
                  index === 0 && "pt-3",
                  isUser && index > 0 && "pt-12",
                  isLastTurnRow && "pb-8"
                )}
                dataTurn={message.role}
                dataTurnId={message.id}
                dataTestId={`conversation-turn-${index + 1}`}
              >
                {messageContent}
              </TurnRow>
            </Fragment>
          )
        })}
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
