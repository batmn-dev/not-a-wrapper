import { ScrollRootContent } from "@/components/ui/scroll-root"
import { Message as MessageContainer } from "@/components/ui/message"
import { ThinkingBar } from "@/components/ui/thinking-bar"
import {
  type ChatMessageMetadata,
  resolveTurnBranch,
} from "@/lib/chat-messages/branch"
import {
  type DurableMessageStatus,
  isDurableMessageStatus,
} from "@/lib/chat-messages/durable-contract"
import { extractTextFromMessageParts } from "@/lib/chat-messages/parts"
import { cn } from "@/lib/utils"
import { UIMessage as MessageType } from "@ai-sdk/react"
import type { EditTurnResult } from "./chat-turn"
import { Message } from "./message"

type MessageRenderStatus =
  | DurableMessageStatus
  | "ready"
  | "error"

function isMessageRenderStatus(value: unknown): value is MessageRenderStatus {
  return (
    value === "ready" ||
    value === "error" ||
    isDurableMessageStatus(value)
  )
}

// v6 helper: Extract text content from all text parts in order.
// Tool-enabled responses can interleave multiple assistant text parts across
// steps; using only the first part makes responses appear truncated.
function getMessageText(message: MessageType): string {
  return extractTextFromMessageParts(message.parts)
}

// Extract file attachments from parts array
function getMessageAttachments(
  message: MessageType
): Array<{ name: string; contentType: string; url: string }> | undefined {
  const fileParts = message.parts?.filter((p) => p.type === "file")
  if (!fileParts || fileParts.length === 0) return undefined
  return fileParts.map((p) => ({
    name: (p as { filename?: string }).filename || "file",
    contentType: (p as { mediaType?: string }).mediaType || "application/octet-stream",
    url: (p as { url?: string }).url || "",
  }))
}

type ConversationProps = {
  messages: MessageType[]
  status?: "streaming" | "ready" | "submitted" | "error"
  isSubmitting?: boolean
  /** Id of the panel-active assistant turn (the rendered selected-path tail),
   * forwarded to each Message so branch switches / handoffs re-render affected
   * rows. Derived once by Chat via useActivityPanel. */
  activeTurnId?: string
  onDelete: (id: string) => void
  onEdit: (
    id: string,
    newText: string
  ) => Promise<EditTurnResult | void> | EditTurnResult | void
  onReload: (messageId: string) => void
  onStop?: () => void
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

export function Conversation({
  messages,
  status = "ready",
  isSubmitting = false,
  activeTurnId,
  onDelete,
  onEdit,
  onReload,
  onStop,
  onQuote,
  onSelectBranch,
  isDurableChat,
  lastFinishReason,
  onToolApproval,
}: ConversationProps) {
  if (!messages || messages.length === 0)
    return <div className="w-full flex-1"></div>

  const isGenerationActive =
    isSubmitting || status === "submitted" || status === "streaming"

  return (
    <ScrollRootContent className="relative flex w-full flex-1 flex-col items-center pt-4 [--composer-overlap-px:28px] [--thread-bottom-offset:calc(var(--spacing-input-area)+2rem+env(safe-area-inset-bottom,0px))] pb-[var(--thread-bottom-offset)] -mb-[var(--composer-overlap-px)]">
      <div
        aria-hidden="true"
        data-edge="top"
        className="pointer-events-none absolute top-0 h-px w-px"
      />
      {messages?.map((message, index) => {
        const isLast =
          index === messages.length - 1 && status !== "submitted"
        const isAssistant = message.role === "assistant"
        const isUser = message.role === "user"

        // Branch nav always anchors on the user message (the turn): show the
        // user's own edit branch, or — when the prompt itself wasn't edited —
        // the response's regenerate branch. Assistant messages never render the
        // control; selecting a response sibling still works because the branch
        // descriptor carries the assistant sibling ids.
        const turnBranch = resolveTurnBranch(message, messages[index + 1])
        const durableStatus = (message as { status?: string }).status
        const messageStatus: MessageRenderStatus =
          isMessageRenderStatus(durableStatus) && durableStatus !== "completed"
            ? durableStatus
            : isLast
              ? status
              : "ready"

        return (
          <article
            key={message.id}
            className={cn(
              "text-base mx-auto w-full [--thread-content-margin:1rem] @sm/main:[--thread-content-margin:1.5rem] @lg/main:[--thread-content-margin:4rem] px-[var(--thread-content-margin,1rem)]",
              isUser && "pt-3 scroll-mt-[var(--spacing-app-header)]",
              isAssistant && "pb-10 scroll-mt-[calc(var(--spacing-app-header)+min(200px,max(70px,20svh)))]"
            )}
            data-turn={message.role}
          >
            <div className="group/turn-messages relative mx-auto flex w-full min-w-0 [--thread-content-max-width:40rem] @[64rem]/main:[--thread-content-max-width:48rem] max-w-[var(--thread-content-max-width,40rem)] flex-1 flex-col">
              <Message
                id={message.id}
                variant={message.role}
                attachments={getMessageAttachments(message)}
                isLast={isLast}
                activeTurnId={activeTurnId}
                onDelete={onDelete}
                onEdit={onEdit}
                onReload={isGenerationActive ? undefined : onReload}
                onStop={isLast && status === "streaming" ? onStop : undefined}
                onSelectBranch={onSelectBranch}
                branch={turnBranch}
                parts={message.parts}
                metadata={message.metadata as ChatMessageMetadata | undefined}
                status={messageStatus}
                onQuote={onQuote}
                isDurableChat={isDurableChat}
                finishReason={isLast ? lastFinishReason : undefined}
                onToolApproval={onToolApproval}
              >
                {getMessageText(message)}
              </Message>
            </div>
          </article>
        );
      })}
      {status === "submitted" &&
        messages.length > 0 &&
        messages[messages.length - 1].role === "user" && (
          <div
            className="text-base mx-auto w-full [--thread-content-margin:1rem] @sm/main:[--thread-content-margin:1.5rem] @lg/main:[--thread-content-margin:4rem] px-[var(--thread-content-margin,1rem)] pb-10 scroll-mt-[calc(var(--spacing-app-header)+min(200px,max(70px,20svh)))]"
            data-turn="assistant"
          >
            <div className="group/turn-messages relative mx-auto flex w-full min-w-0 [--thread-content-max-width:40rem] @[64rem]/main:[--thread-content-max-width:48rem] max-w-[var(--thread-content-max-width,40rem)] flex-1 flex-col">
              <MessageContainer className="flex w-full flex-1 items-start gap-4">
                <div className="relative flex min-w-full flex-col gap-2">
                  <ThinkingBar text="Thinking" onStop={onStop} />
                </div>
              </MessageContainer>
            </div>
          </div>
        )}
      <div
        aria-hidden="true"
        data-edge="bottom"
        className="pointer-events-none absolute bottom-0 h-px w-px"
      />
    </ScrollRootContent>
  );
}
