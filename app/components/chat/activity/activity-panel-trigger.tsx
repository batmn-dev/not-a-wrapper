"use client"

import { Icon } from "@/components/ui/icon"
import type { AssistantActivityPresentation } from "@/lib/chat-messages/assistant-activity"
import { cn } from "@/lib/utils"
import { RiArrowRightSLine } from "@remixicon/react"
import { StatusText } from "./status-text"

export type ActivityDisclosurePresentation = Extract<
  AssistantActivityPresentation,
  { kind: "disclosure" }
>

export type ActivityPanelTriggerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  controlsId?: string
  presentation: ActivityDisclosurePresentation
  className?: string
}

/** The native disclosure control for a prevalidated non-empty Activity view. */
export function ActivityPanelTrigger({
  open,
  onOpenChange,
  controlsId,
  presentation,
  className,
}: ActivityPanelTriggerProps) {
  const { label, motion } = presentation

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
      <StatusText
        label={label}
        shimmer={motion === "shimmer"}
        className="truncate"
      />
      <Icon
        icon={RiArrowRightSLine}
        slotSize={12}
        className="text-[var(--text-tertiary)] transition-transform group-hover/activity:translate-x-0.5 motion-reduce:transition-none"
      />
    </button>
  )
}
