import type {
  ChatMessageMetadata,
  MessageBranchInfo,
} from "@/lib/chat-messages/branch"
import type { DurableMessageStatus } from "@/lib/chat-messages/durable-contract"
import {
  extractTextFromMessageParts,
  getToolRenderSignature,
} from "@/lib/chat-messages/parts"
import { UIMessage as MessageType } from "@ai-sdk/react"
import React, { useState } from "react"
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
  /** Id of the panel-active assistant turn (the rendered selected-path tail).
   * Threaded so a branch switch / active-turn handoff re-renders affected rows
   * even when their body content is unchanged. */
  activeTurnId?: string
  /** Whether the Chat-owned Activity panel is currently expanded. */
  activityPanelOpen?: boolean
  /** Stable id of the Chat-owned Activity panel surface. */
  activityPanelId?: string
  /** Opens or closes the Chat-owned Activity panel; forwarded to the assistant
   * trigger. */
  onActivityPanelOpenChange?: (open: boolean) => void
  onDelete: (id: string) => void
  onEdit: (
    id: string,
    newText: string
  ) => Promise<EditTurnResult | void> | EditTurnResult | void
  onReload?: (messageId: string) => void
  onStop?: () => void
  onSelectBranch?: (messageId: string) => void
  /** Branch descriptor to render for this message's turn (anchored on the user
   * message in conversation.tsx). Undefined for assistant messages. */
  branch?: MessageBranchInfo
  parts?: MessageType["parts"]
  /** Immutable snapshot of rendered tool input/output for memo comparison.
   * Conversation computes this during render so in-place part mutations do not
   * make the previous and next memo props point at the same mutated object. */
  toolRenderSignature?: string
  metadata?: ChatMessageMetadata
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

// --- Content-based equality helpers for React.memo ---

function getTextContent(parts: MessageType["parts"] | undefined): string {
  return extractTextFromMessageParts(parts)
}

function getComparableToolSignature({
  parts,
  toolRenderSignature,
}: Pick<MessageProps, "parts" | "toolRenderSignature">): string {
  return toolRenderSignature ?? getToolRenderSignature(parts)
}

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

function areMessagesEqual(prev: MessageProps, next: MessageProps): boolean {
  if (prev.variant !== next.variant) return false
  if (prev.id !== next.id) return false

  // A branch switch or active-turn handoff must re-render the assistant row so
  // its panel/trigger affordances follow the newly selected turn — even when the
  // body content is unchanged (GA §6.7E, §7 R3).
  if (prev.activeTurnId !== next.activeTurnId) return false
  if (prev.activityPanelOpen !== next.activityPanelOpen) return false
  if (prev.activityPanelId !== next.activityPanelId) return false

  // While the last message actively streams, skip re-render unless the rendered
  // body changed. Reasoning + source deltas no longer churn the body — the
  // Activity panel owns and updates that state — so only text and rendered tool
  // projections gate a body re-render here. Conversation provides tool
  // projections as an immutable string so in-place AI SDK part mutations do not
  // make previous and next memo props compare against the same mutated object.
  // This narrows the previous blanket `return false`, which re-rendered on
  // every streaming delta.
  if (next.status === "streaming" && next.isLast) {
    if (getTextContent(prev.parts) !== getTextContent(next.parts)) return false
    if (getComparableToolSignature(prev) !== getComparableToolSignature(next)) {
      return false
    }
    // Reasoning-only deltas fall through to the remaining structural gates.
  }

  // Content comparisons via parts
  if (getTextContent(prev.parts) !== getTextContent(next.parts)) return false
  if (getComparableToolSignature(prev) !== getComparableToolSignature(next))
    return false

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
  if (prev.isDurableChat !== next.isDurableChat) return false
  if (Boolean(prev.onReload) !== Boolean(next.onReload)) return false
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
  activeTurnId,
  activityPanelOpen,
  activityPanelId,
  onActivityPanelOpenChange,
  onEdit,
  onReload,
  onStop,
  onSelectBranch,
  branch,
  parts,
  metadata,
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
        onStop={onStop}
        isLast={isLast}
        activeTurnId={activeTurnId}
        activityPanelOpen={activityPanelOpen}
        activityPanelId={activityPanelId}
        onActivityPanelOpenChange={onActivityPanelOpenChange}
        parts={parts}
        metadata={metadata}
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
