"use client"

import { Icon } from "@/components/ui/icon"
import {
  getMessageBranchInfo,
  isNavigableBranch,
  type ChatMessageMetadata,
  type MessageBranchInfo,
} from "@/lib/chat-messages/branch"
import { cn } from "@/lib/utils"
import { RiArrowLeftSLine, RiArrowRightSLine } from "@remixicon/react"
import { MessageActionButton } from "./message-action-button"

/**
 * Resolve the typed branch descriptor for a message's metadata, returning it
 * only when there is more than one sibling to navigate between. Branch state is
 * first-class (see `lib/chat-messages/branch.ts`); this reads it without
 * casting metadata to `Record<string, unknown>`.
 */
export function getMessageBranch(
  metadata: ChatMessageMetadata | undefined
): MessageBranchInfo | undefined {
  const branch = getMessageBranchInfo({ metadata })
  return isNavigableBranch(branch) ? branch : undefined
}

export function MessageBranchControls({
  branch,
  onSelectBranch,
  className,
}: {
  branch: MessageBranchInfo | undefined
  onSelectBranch?: (messageId: string) => void
  className?: string
}) {
  if (!branch || !onSelectBranch) return null

  const previousSibling = branch.siblings[branch.currentIndex - 1]
  const nextSibling = branch.siblings[branch.currentIndex + 1]
  const currentBranch = branch.currentIndex + 1

  return (
    <div
      className={cn(
        "text-muted-foreground flex h-8 items-center gap-0.5 px-1 text-xs pointer-coarse:h-10",
        className
      )}
      aria-label={`Branch ${currentBranch} of ${branch.total}`}
    >
      <MessageActionButton
        label="Previous branch"
        delay={0}
        disabled={!previousSibling}
        onClick={() => {
          if (previousSibling) onSelectBranch(previousSibling.messageId)
        }}
        icon={<Icon icon={RiArrowLeftSLine} slotSize={20} />}
      />
      <span className="tabular-nums">
        {currentBranch} / {branch.total}
      </span>
      <MessageActionButton
        label="Next branch"
        delay={0}
        disabled={!nextSibling}
        onClick={() => {
          if (nextSibling) onSelectBranch(nextSibling.messageId)
        }}
        icon={<Icon icon={RiArrowRightSLine} slotSize={20} />}
      />
    </div>
  )
}
