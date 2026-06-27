"use client"

import { Icon } from "@/components/ui/icon"
import { formatDuration } from "@/components/ui/reasoning"
import { TextShimmer } from "@/components/ui/text-shimmer"
import { cn } from "@/lib/utils"
import { RiArrowRightSLine } from "@remixicon/react"

/**
 * The thinking states the trigger can display. Composable — add a variant here
 * and `activityStateLabel` renders it. "thinking" shimmers; the rest are static.
 */
export type ActivityTriggerState =
  | { status: "thinking" }
  | { status: "thought"; durationSeconds?: number }
  | { status: "sources"; count: number }
  | { status: "activity" }

export function activityStateLabel(state: ActivityTriggerState): string {
  switch (state.status) {
    case "thinking":
      return "Thinking"
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
  /** Opens (or reopens) the Chat-owned Activity panel. */
  onOpen: () => void
  /** The current thinking state; the trigger composes the label from it. */
  state: ActivityTriggerState
  className?: string
}

/**
 * ActivityPanelTrigger — the explicit, focusable reopen affordance for the
 * Activity panel (plan §5 commit 5). Renders a composable thinking-state label
 * ("Thinking" / "Thought for 1s" / "N sources") with a trailing chevron — no
 * leading icon — and opens the panel on click. It renders NO reasoning/source
 * content; the overlay primitives (Sheet / docked section) restore focus here
 * on close. The "thinking" state shimmers (motion-reduce gated).
 */
export function ActivityPanelTrigger({
  onOpen,
  state,
  className,
}: ActivityPanelTriggerProps) {
  const label = activityStateLabel(state)
  const pending = state.status === "thinking"

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open activity: ${label}`}
      className={cn(
        "group/activity text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 rounded-full text-sm transition-colors",
        className
      )}
    >
      {pending ? (
        <TextShimmer
          duration={2}
          spread={15}
          className="text-sm motion-reduce:animate-none"
        >
          {label}
        </TextShimmer>
      ) : (
        <span className="truncate">{label}</span>
      )}
      <Icon
        icon={RiArrowRightSLine}
        slotSize={16}
        className="text-muted-foreground/70 transition-transform group-hover/activity:translate-x-0.5 motion-reduce:transition-none"
      />
    </button>
  )
}
