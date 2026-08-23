"use client"

import type { AssistantActivityPresentation } from "@/lib/chat-messages/assistant-activity"
import { cn } from "@/lib/utils"
import { ActivityPanelTrigger } from "./activity/activity-panel-trigger"
import { ActivityStatusRow, StatusText } from "./activity/status-text"

const ASSISTANT_ACTIVITY_SLOT_CLASS =
  "flex min-h-8 min-w-0 max-w-full shrink-0 items-start gap-2 text-start"

export type AssistantActivityIndicatorProps = {
  presentation: AssistantActivityPresentation
  open: boolean
  onOpenChange?: (open: boolean) => void
  controlsId?: string
  className?: string
}

/**
 * Exhaustive renderer for live, passive, and inspectable assistant activity.
 * Every non-empty presentation owns the same 32px slot; its 24px status row or
 * disclosure can change without contracting the assistant turn.
 */
export function AssistantActivityIndicator({
  presentation,
  open,
  onOpenChange,
  controlsId,
  className,
}: AssistantActivityIndicatorProps) {
  switch (presentation.kind) {
    case "none":
      return null
    case "live-status": {
      if (presentation.semanticKind !== "thinking") {
        return (
          <div
            className={cn(ASSISTANT_ACTIVITY_SLOT_CLASS, className)}
            data-activity-presentation="live-status"
            data-slot="assistant-activity"
          >
            <ActivityStatusRow
              label={presentation.label}
              shimmer={presentation.motion === "shimmer"}
              className="text-muted-foreground"
            />
          </div>
        )
      }

      return (
        <div
          aria-busy="true"
          className={cn(
            ASSISTANT_ACTIVITY_SLOT_CLASS,
            "text-base leading-6 text-[var(--text-tertiary)]",
            className
          )}
          data-activity-presentation="live-status"
          data-slot="assistant-activity"
        >
          <StatusText
            as="div"
            label={presentation.label}
            shimmer={presentation.motion === "shimmer"}
            shimmerVariant="tertiary"
            className="pb-0.5 select-none"
          />
        </div>
      )
    }
    case "passive":
      return (
        <div
          className={cn(ASSISTANT_ACTIVITY_SLOT_CLASS, className)}
          data-activity-presentation="passive"
          data-slot="assistant-activity"
        >
          <ActivityStatusRow
            label={presentation.label}
            shimmer={false}
            className="text-muted-foreground"
          />
        </div>
      )
    case "disclosure":
      return (
        <div
          className={cn(ASSISTANT_ACTIVITY_SLOT_CLASS, className)}
          data-activity-presentation="disclosure"
          data-slot="assistant-activity"
        >
          {onOpenChange ? (
            <ActivityPanelTrigger
              open={open}
              onOpenChange={onOpenChange}
              controlsId={controlsId}
              presentation={presentation}
            />
          ) : (
            <ActivityStatusRow
              label={presentation.label}
              shimmer={presentation.motion === "shimmer"}
              className="text-muted-foreground"
            />
          )}
        </div>
      )
  }
}
