import { UIMessage as MessageType } from "@ai-sdk/react"
import { isStaticToolUIPart, getStaticToolName } from "ai"
import React, { useState } from "react"
import type { DurableMessageStatus } from "@/lib/chat-messages/durable-contract"
import { extractTextFromMessageParts } from "@/lib/chat-messages/parts"
import type { EditTurnResult } from "./chat-turn"
import { MessageAssistant } from "./message-assistant"
import { MessageUser } from "./message-user"

// Attachment type for file parts
type MessageAttachment = {
  name: string
  contentType: string
  url: string
}

type MessageProps = {
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
  onReload: (messageId: string) => void
  onStop?: () => void
  onSelectBranch?: (messageId: string) => void
  parts?: MessageType["parts"]
  metadata?: Record<string, unknown>
  status?: DurableMessageStatus | "ready" | "error"
  className?: string
  onQuote?: (text: string, messageId: string) => void
  isUserAuthenticated?: boolean
  finishReason?: string
  onToolApproval?: (
    approvalId: string,
    approved: boolean,
    reason?: string
  ) => Promise<void> | void
}

// --- Content-based equality helpers for React.memo ---

function getTextContent(parts: MessageType["parts"] | undefined): string {
  return extractTextFromMessageParts(parts)
}

function getReasoningContent(parts: MessageType["parts"] | undefined): string {
  if (!parts) return ""
  let text = ""
  for (const part of parts) {
    if (part.type === "reasoning") text += part.text
  }
  return text
}

function getToolSignature(parts: MessageType["parts"] | undefined): string {
  if (!parts) return ""
  let sig = ""
  for (const part of parts) {
    if (isStaticToolUIPart(part)) {
      sig += getStaticToolName(part) + ":" + part.state + ";"
    }
  }
  return sig
}

function areMessagesEqual(prev: MessageProps, next: MessageProps): boolean {
  if (prev.variant !== next.variant) return false
  if (prev.id !== next.id) return false

  // Streaming messages mutate deeply (reasoning/text deltas). Skip
  // content-level diffing while the message is actively being built —
  // the structuredClone in the AI SDK creates new objects, but React
  // Compiler memoization can retain stale references for nested parts.
  if (next.status === "streaming" && next.isLast) return false

  // Content comparisons via parts
  if (getTextContent(prev.parts) !== getTextContent(next.parts)) return false
  if (getReasoningContent(prev.parts) !== getReasoningContent(next.parts)) return false
  if (getToolSignature(prev.parts) !== getToolSignature(next.parts)) return false

  // Fallback: if parts are both empty/undefined, compare children directly
  if (!prev.parts?.length && !next.parts?.length) {
    if (prev.children !== next.children) return false
  }
  // If parts matched but children diverged (shouldn't happen, but safety net)
  if (prev.children !== next.children) return false

  if (prev.isLast !== next.isLast) return false
  if (prev.status !== next.status) return false
  if (prev.metadata !== next.metadata) return false
  if (prev.finishReason !== next.finishReason) return false
  if (prev.className !== next.className) return false
  if (prev.isUserAuthenticated !== next.isUserAuthenticated) return false
  if (
    prev.variant === "assistant" &&
    prev.onToolApproval !== next.onToolApproval
  ) return false
  if (prev.onSelectBranch !== next.onSelectBranch) return false

  // Attachments: compare all rendered fields
  const prevLen = prev.attachments?.length ?? 0
  const nextLen = next.attachments?.length ?? 0
  if (prevLen !== nextLen) return false
  if (prev.attachments && next.attachments) {
    for (let i = 0; i < prevLen; i++) {
      const p = prev.attachments[i]
      const n = next.attachments[i]
      if (p.url !== n.url || p.name !== n.name || p.contentType !== n.contentType) return false
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
  onEdit,
  onReload,
  onStop,
  onSelectBranch,
  parts,
  metadata,
  status,
  className,
  onQuote,
  isUserAuthenticated,
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
        isUserAuthenticated={isUserAuthenticated}
        metadata={metadata}
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
        onStop={onStop}
        onSelectBranch={onSelectBranch}
        isLast={isLast}
        parts={parts}
        metadata={metadata}
        status={status}
        className={className}
        messageId={id}
        onQuote={onQuote}
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
