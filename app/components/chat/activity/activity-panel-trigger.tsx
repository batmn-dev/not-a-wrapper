"use client"

import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/utils"
import { RiSparkling2Line } from "@remixicon/react"

export type ActivityPanelTriggerProps = {
  /** Opens (or reopens) the Chat-owned Activity panel. */
  onOpen: () => void
  /** Optional compact summary, e.g. "Thinking" / "3 sources". */
  summary?: string
  className?: string
}

/**
 * ActivityPanelTrigger — the explicit, focusable reopen affordance for the
 * Activity panel (plan §5 commit 5). Replaces the old inline `ReasoningLabel`
 * affordance; it renders NO reasoning/source content, only opens the panel.
 * A real `<button>`, so keyboard activation works and the overlay primitives
 * (Sheet / docked section) restore focus here on close.
 */
export function ActivityPanelTrigger({
  onOpen,
  summary = "Activity",
  className,
}: ActivityPanelTriggerProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open activity"
      className={cn(
        "text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1.5 rounded-full text-sm transition-colors",
        className
      )}
    >
      <Icon icon={RiSparkling2Line} slotSize={16} />
      <span className="truncate">{summary}</span>
    </button>
  )
}
