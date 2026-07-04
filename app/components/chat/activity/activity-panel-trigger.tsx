"use client"

import { Icon } from "@/components/ui/icon"
import { TextShimmer } from "@/components/ui/text-shimmer"
import type { ActivityTriggerState } from "@/lib/chat-messages/assistant-turn"
import { formatDuration } from "@/lib/format-duration"
import { cn } from "@/lib/utils"
import { RiArrowRightSLine } from "@remixicon/react"

// The trigger state union is derived data and lives with the Assistant turn
// phase derivation (lib/chat-messages/assistant-turn.ts); re-exported here so
// presentation-side consumers keep one import path.
export type { ActivityTriggerState }

export function activityStateLabel(state: ActivityTriggerState): string {
  switch (state.status) {
    case "thinking":
      return "Thinking"
    case "running":
      return state.label
    case "thought":
      return state.durationSeconds !== undefined
        ? `Thought for ${formatDuration(state.durationSeconds)}`
        : "Thought"
    case "sources":
      return `${state.count} source${state.count === 1 ? "" : "s"}`
    case "activity":
      return "Activity"
  }
}

export type ActivityPanelTriggerProps = {
  /** Whether the Chat-owned Activity panel is currently expanded. */
  open: boolean
  /** Opens or closes the Chat-owned Activity panel. */
  onOpenChange: (open: boolean) => void
  /** Stable id of the controlled panel surface, when mounted. */
  controlsId?: string
  /** The current thinking state; the trigger composes the label from it. */
  state: ActivityTriggerState
  className?: string
}

/**
 * ActivityPanelTrigger — the explicit, focusable reopen affordance for the
 * Activity panel (plan §5 commit 5). Renders a composable thinking-state label
 * ("Thinking" / "Searching the web" / "Thought for 1s" / "N sources") with a
 * trailing chevron — no leading icon — and toggles the panel on click. It
 * renders NO reasoning/source content; the overlay primitives (Sheet / docked
 * section) restore focus here on close. The live "thinking" and "running"
 * states shimmer (motion-reduce gated).
 */
export function ActivityPanelTrigger({
  open,
  onOpenChange,
  controlsId,
  state,
  className,
}: ActivityPanelTriggerProps) {
  const label = activityStateLabel(state)
  const pending = state.status === "thinking" || state.status === "running"

  return (
    <button
      type="button"
      onClick={() => onOpenChange(!open)}
      aria-label={`${open ? "Close" : "Open"} activity: ${label}`}
      aria-expanded={open}
      aria-controls={controlsId}
      className={cn(
        "group/activity text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-0.5 rounded-full text-start text-base leading-6 font-normal transition-colors",
        className
      )}
    >
      {pending ? (
        <TextShimmer
          duration={2}
          spread={15}
          className="text-base leading-6 font-normal motion-reduce:animate-none"
        >
          {label}
        </TextShimmer>
      ) : (
        <span className="truncate">{label}</span>
      )}
      {/* Reference disclosure chevron is icon-xs (12px box), not a 20px slot —
          the svg's width/height="20" attrs are overridden by .icon-xs. */}
      <Icon
        icon={RiArrowRightSLine}
        slotSize={12}
        className="text-muted-foreground/70 transition-transform group-hover/activity:translate-x-0.5 motion-reduce:transition-none"
      />
    </button>
  )
}
