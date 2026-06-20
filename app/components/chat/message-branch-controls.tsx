"use client"

import { Icon } from "@/components/ui/icon"
import { MessageAction } from "@/components/ui/message"
import { cn } from "@/lib/utils"
import { RiArrowLeftSLine, RiArrowRightSLine } from "@remixicon/react"

export type MessageBranchMetadata = {
  messageId: string
  currentIndex: number
  total: number
  siblings: Array<{
    messageId: string
    clientMessageId?: string
  }>
}

function isBranchMetadata(value: unknown): value is MessageBranchMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.messageId === "string" &&
    typeof record.currentIndex === "number" &&
    typeof record.total === "number" &&
    Array.isArray(record.siblings) &&
    record.siblings.every((sibling) => {
      return (
        sibling &&
        typeof sibling === "object" &&
        !Array.isArray(sibling) &&
        typeof (sibling as Record<string, unknown>).messageId === "string"
      )
    })
  )
}

export function getMessageBranch(
  metadata: Record<string, unknown> | undefined
) {
  const branch = metadata?.branch
  if (!isBranchMetadata(branch)) return undefined
  if (branch.total < 2 || branch.siblings.length !== branch.total) {
    return undefined
  }
  if (branch.currentIndex < 0 || branch.currentIndex >= branch.total) {
    return undefined
  }
  return branch
}

export function MessageBranchControls({
  branch,
  onSelectBranch,
  className,
}: {
  branch: MessageBranchMetadata | undefined
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
      <MessageAction tooltip="Previous branch" side="bottom" delay={0}>
        <button
          className="hover:bg-accent/60 hover:text-foreground disabled:text-muted-foreground/40 flex h-8 w-8 items-center justify-center rounded-lg bg-transparent transition disabled:pointer-events-none pointer-coarse:h-10 pointer-coarse:w-10"
          aria-label="Previous branch"
          disabled={!previousSibling}
          onClick={() => {
            if (previousSibling) onSelectBranch(previousSibling.messageId)
          }}
          type="button"
        >
          <Icon icon={RiArrowLeftSLine} slotSize={20} />
        </button>
      </MessageAction>
      <span className="tabular-nums">
        {currentBranch} / {branch.total}
      </span>
      <MessageAction tooltip="Next branch" side="bottom" delay={0}>
        <button
          className="hover:bg-accent/60 hover:text-foreground disabled:text-muted-foreground/40 flex h-8 w-8 items-center justify-center rounded-lg bg-transparent transition disabled:pointer-events-none pointer-coarse:h-10 pointer-coarse:w-10"
          aria-label="Next branch"
          disabled={!nextSibling}
          onClick={() => {
            if (nextSibling) onSelectBranch(nextSibling.messageId)
          }}
          type="button"
        >
          <Icon icon={RiArrowRightSLine} slotSize={20} />
        </button>
      </MessageAction>
    </div>
  )
}
