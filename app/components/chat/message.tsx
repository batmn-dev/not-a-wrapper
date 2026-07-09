import {
  assistantTurnViewsEqual,
  type AssistantTurnView,
} from "@/lib/chat-messages/assistant-turn"
import type { MessageBranchInfo } from "@/lib/chat-messages/branch"
import type { DurableMessageStatus } from "@/lib/chat-messages/durable-contract"
import { UIMessage as MessageType } from "@ai-sdk/react"
import React, { useState } from "react"
import type { EditTurnResult } from "@/lib/chat-turn/chat-turn-controller"
import { MessageAssistant } from "./message-assistant"
import { MessageUser } from "./message-user"

// Attachment type for file parts
type MessageAttachment = {
  name: string
  contentType: string
  url: string
}

type BaseMessageProps = {
  variant: MessageType["role"]
  children: string
  id: string
  attachments?: MessageAttachment[]
  isLast?: boolean
  onDelete: (id: string) => void
  onEdit: (
    id: string,
    newText: string
  ) => Promise<EditTurnResult | void> | EditTurnResult | void
  onReload?: (messageId: string) => void
  retryModelId?: string
  onSelectBranch?: (messageId: string) => void
  /** Branch descriptor to render for this message's turn (anchored on the user
   * message in conversation.tsx). Undefined for assistant messages. */
  branch?: MessageBranchInfo
  status?: DurableMessageStatus | "ready" | "error"
  className?: string
  onQuote?: (text: string, messageId: string) => void
  isDurableChat?: boolean
  finishReason?: string
  onToolApproval?: (
    approvalId: string,
    approved: boolean,
    reason?: string
  ) => Promise<void> | void
}

type AssistantMessageProps = BaseMessageProps & {
  variant: "assistant"
  /** The Assistant turn view — Conversation derives it once per assistant
   * message per render; the memo comparator below compares its precomputed
   * signature fields instead of re-deriving from raw parts. */
  view: AssistantTurnView
}

type NonAssistantMessageProps = BaseMessageProps & {
  variant: Exclude<MessageType["role"], "assistant">
  view?: never
}

type MessageProps = AssistantMessageProps | NonAssistantMessageProps

// --- Content-based equality helpers for React.memo ---

function branchesEqual(
  prev: MessageBranchInfo | undefined,
  next: MessageBranchInfo | undefined
): boolean {
  if (prev === next) return true
  if (!prev || !next) return false
  if (
    prev.messageId !== next.messageId ||
    prev.currentIndex !== next.currentIndex ||
    prev.total !== next.total ||
    prev.siblings.length !== next.siblings.length
  ) {
    return false
  }
  // The control reads sibling ids to pick its prev/next targets, so a change in
  // them must invalidate the memo even when the counters are unchanged.
  return prev.siblings.every(
    (sibling, index) => sibling.messageId === next.siblings[index]?.messageId
  )
}

/**
 * Content-based memo gate. Conversation derives text (`children`) and the
 * Assistant turn view fresh each render — the AI SDK mutates part objects in
 * place during streaming, so the view is a new object every render and
 * equality must be content-based. `children` compares the rendered text;
 * `assistantTurnViewsEqual` compares exactly the remaining facts the row
 * renders (tool signature, reasoning phase, metadata identity, server id) —
 * deliberately NOT sources: the row's sources presentations (trigger count,
 * footer sources badge) render only on settled turns, and every path into
 * settled re-renders through compared fields (status flip, isLast handoff,
 * metadata adoption). Streaming reasoning/source deltas therefore do NOT
 * churn the row body — the Activity panel owns and updates that state
 * through its own store seam.
 */
function areMessagesEqual(prev: MessageProps, next: MessageProps): boolean {
  if (prev.variant !== next.variant) return false
  if (prev.id !== next.id) return false
  if (prev.children !== next.children) return false
  if (!assistantTurnViewsEqual(prev.view, next.view)) return false

  if (prev.isLast !== next.isLast) return false
  if (prev.status !== next.status) return false
  if (prev.finishReason !== next.finishReason) return false
  if (prev.className !== next.className) return false
  if (prev.isDurableChat !== next.isDurableChat) return false
  if (Boolean(prev.onReload) !== Boolean(next.onReload)) return false
  if (prev.retryModelId !== next.retryModelId) return false
  if (
    prev.variant === "assistant" &&
    prev.onToolApproval !== next.onToolApproval
  )
    return false
  if (prev.onSelectBranch !== next.onSelectBranch) return false
  if (!branchesEqual(prev.branch, next.branch)) return false

  // Attachments: compare all rendered fields
  const prevLen = prev.attachments?.length ?? 0
  const nextLen = next.attachments?.length ?? 0
  if (prevLen !== nextLen) return false
  if (prev.attachments && next.attachments) {
    for (let i = 0; i < prevLen; i++) {
      const p = prev.attachments[i]
      const n = next.attachments[i]
      if (
        p.url !== n.url ||
        p.name !== n.name ||
        p.contentType !== n.contentType
      )
        return false
    }
  }

  return true
}

// --- Component ---

function MessageInner({
  variant,
  children,
  id,
  attachments,
  isLast,
  view,
  onEdit,
  onReload,
  retryModelId,
  onSelectBranch,
  branch,
  status,
  className,
  onQuote,
  isDurableChat,
  finishReason,
  onToolApproval,
}: MessageProps) {
  const [copied, setCopied] = useState(false)

  const copyToClipboard = () => {
    navigator.clipboard.writeText(children)
    setCopied(true)
    setTimeout(() => setCopied(false), 500)
  }

  if (variant === "user") {
    return (
      <MessageUser
        copied={copied}
        copyToClipboard={copyToClipboard}
        onReload={onReload}
        onEdit={onEdit}
        id={id}
        attachments={attachments}
        className={className}
        isDurableChat={isDurableChat}
        branch={branch}
        onSelectBranch={onSelectBranch}
      >
        {children}
      </MessageUser>
    )
  }

  if (variant === "assistant") {
    return (
      <MessageAssistant
        copied={copied}
        copyToClipboard={copyToClipboard}
        onReload={onReload}
        retryModelId={retryModelId}
        isLast={isLast}
        view={view}
        status={status}
        className={className}
        messageId={id}
        onQuote={onQuote}
        isDurableChat={isDurableChat}
        finishReason={finishReason}
        onToolApproval={onToolApproval}
      >
        {children}
      </MessageAssistant>
    )
  }

  return null
}

const MemoizedMessage = React.memo(MessageInner, areMessagesEqual)
export { MemoizedMessage as Message }
