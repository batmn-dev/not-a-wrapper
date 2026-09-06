import {
  turnRowModelsEqual,
  type TurnRowModel,
} from "@/lib/chat-messages/turn-row"
import type {
  EditTurnResult,
  RegenerationTurnOverrides,
} from "@/lib/chat-turn/chat-turn-controller"
import React, { useEffect, useRef, useState } from "react"
import { MessageAssistant } from "./message-assistant"
import { MessageUser } from "./message-user"

type MessageProps = {
  model: TurnRowModel
  isReplaying?: boolean
  onEdit: (
    id: string,
    newText: string
  ) => Promise<EditTurnResult | void> | EditTurnResult | void
  onEditingChange?: (messageId: string, isEditing: boolean) => void
  onReload?: (messageId: string, overrides?: RegenerationTurnOverrides) => void
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
  if (prev.isReplaying !== next.isReplaying) return false
  if (Boolean(prev.onReload) !== Boolean(next.onReload)) return false
  if (prev.onSelectBranch !== next.onSelectBranch) return false
  return true
}

function MessageInner({
  model,
  isReplaying = false,
  onEdit,
  onEditingChange,
  onReload,
  onSelectBranch,
  onQuote,
}: MessageProps) {
  const [copiedText, setCopiedText] = useState<string | null>(null)
  const copied = copiedText === model.text
  const copyAttemptRef = useRef(0)
  const copyFeedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )

  useEffect(() => {
    // A new canonical value invalidates feedback from an older click. This
    // also prevents an in-flight clipboard promise from publishing stale
    // success after the row has adopted a newer durable snapshot.
    copyAttemptRef.current += 1
    if (copyFeedbackTimeoutRef.current !== null) {
      clearTimeout(copyFeedbackTimeoutRef.current)
      copyFeedbackTimeoutRef.current = null
    }

    return () => {
      if (copyFeedbackTimeoutRef.current !== null) {
        clearTimeout(copyFeedbackTimeoutRef.current)
        copyFeedbackTimeoutRef.current = null
      }
    }
  }, [model.text])

  const copyToClipboard = async () => {
    const attempt = ++copyAttemptRef.current
    const clipboard =
      typeof navigator === "undefined" ? undefined : navigator.clipboard
    if (!clipboard?.writeText) return

    try {
      await clipboard.writeText(model.text)
    } catch {
      return
    }

    // Repeated clicks are allowed, but only the latest attempt owns feedback.
    if (attempt !== copyAttemptRef.current) return
    setCopiedText(model.text)
    if (copyFeedbackTimeoutRef.current !== null) {
      clearTimeout(copyFeedbackTimeoutRef.current)
    }
    copyFeedbackTimeoutRef.current = setTimeout(() => {
      copyFeedbackTimeoutRef.current = null
      setCopiedText(null)
    }, 500)
  }

  const sharePrompt = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ text: model.text })
        return
      }
      await navigator.clipboard?.writeText(model.text)
    } catch {
      // Closing the platform share sheet is not an error state for the turn.
    }
  }

  if (model.kind === "user") {
    return (
      <MessageUser
        copied={copied}
        copyToClipboard={copyToClipboard}
        sharePrompt={sharePrompt}
        onReload={onReload}
        onEdit={onEdit}
        isEditing={model.isEditing}
        onEditingChange={(isEditing) => onEditingChange?.(model.id, isEditing)}
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
        isReplaying={isReplaying}
        copied={copied}
        copyToClipboard={copyToClipboard}
        onReload={onReload}
        retryModelId={model.retryModelId}
        retryDisabled={model.retryDisabled}
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

  if (model.kind === "unsupported") {
    // Conversation retains non-chat roles in its row model, but the chat UI
    // intentionally renders only user and assistant turns.
    return null
  }

  return null
}

const MemoizedMessage = React.memo(MessageInner, areMessagesEqual)
export { MemoizedMessage as Message }
