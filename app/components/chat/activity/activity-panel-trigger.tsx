"use client"

import { Icon } from "@/components/ui/icon"
import type { AssistantActivityPresentation } from "@/lib/chat-messages/assistant-activity"
import { cn } from "@/lib/utils"
import { RiArrowRightSLine } from "@remixicon/react"
import { ActivityStatusRow } from "./status-text"

// The Remix arrow occupies only part of its 24px viewBox. A 17px SVG inside
// the stable 16px layout slot keeps the painted chevron optically balanced
// while preserving the shared row geometry.
const ACTIVITY_CHEVRON_SLOT_SIZE = 16
const ACTIVITY_CHEVRON_GLYPH_SIZE = 17

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
        "group/activity text-muted-foreground hover:text-foreground inline-flex w-fit rounded-full text-start transition-colors",
        className
      )}
    >
      <ActivityStatusRow
        label={label}
        shimmer={motion === "shimmer"}
        trailing={
          <Icon
            icon={RiArrowRightSLine}
            slotSize={ACTIVITY_CHEVRON_SLOT_SIZE}
            glyphSize={ACTIVITY_CHEVRON_GLYPH_SIZE}
            className="text-current transition-transform group-hover/activity:translate-x-0.5 motion-reduce:transition-none"
          />
        }
      />
    </button>
  )
}
