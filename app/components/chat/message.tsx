import {
  turnRowModelsEqual,
  type TurnRowModel,
} from "@/lib/chat-messages/turn-row"
import React, { useState } from "react"
import type { EditTurnResult } from "@/lib/chat-turn/chat-turn-controller"
import { MessageAssistant } from "./message-assistant"
import { MessageUser } from "./message-user"

type MessageProps = {
  model: TurnRowModel
  onEdit: (
    id: string,
    newText: string
  ) => Promise<EditTurnResult | void> | EditTurnResult | void
  onReload?: (messageId: string) => void
  onSelectBranch?: (messageId: string) => void
  onQuote?: (text: string, messageId: string) => void
}

/**
 * Handler identity is deliberately outside the rendered model. Reload
 * availability is rendered, so its presence participates in equality; the
 * branch callback retains its existing identity-sensitive contract.
 */
function areMessagesEqual(prev: MessageProps, next: MessageProps): boolean {
  if (!turnRowModelsEqual(prev.model, next.model)) return false
  if (Boolean(prev.onReload) !== Boolean(next.onReload)) return false
  if (prev.onSelectBranch !== next.onSelectBranch) return false
  return true
}

function MessageInner({
  model,
  onEdit,
  onReload,
  onSelectBranch,
  onQuote,
}: MessageProps) {
  const [copied, setCopied] = useState(false)

  const copyToClipboard = () => {
    navigator.clipboard.writeText(model.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 500)
  }

  if (model.kind === "user") {
    return (
      <MessageUser
        copied={copied}
        copyToClipboard={copyToClipboard}
        onReload={onReload}
        onEdit={onEdit}
        id={model.id}
        attachments={model.attachments}
        className={model.className}
        isDurableChat={model.isDurableChat}
        branch={model.branch}
        onSelectBranch={onSelectBranch}
      >
        {model.text}
      </MessageUser>
    )
  }

  if (model.kind === "assistant") {
    return (
      <MessageAssistant
        copied={copied}
        copyToClipboard={copyToClipboard}
        onReload={onReload}
        retryModelId={model.retryModelId}
        isLast={model.isLast}
        view={model.view}
        status={model.status}
        className={model.className}
        messageId={model.id}
        onQuote={onQuote}
        isDurableChat={model.isDurableChat}
        finishReason={model.finishReason}
      >
        {model.text}
      </MessageAssistant>
    )
  }

  return null
}

const MemoizedMessage = React.memo(MessageInner, areMessagesEqual)
export { MemoizedMessage as Message }
