"use client"

import type { AssistantActivityPresentation } from "@/lib/chat-messages/assistant-activity"
import { cn } from "@/lib/utils"
import { ActivityPanelTrigger } from "./activity/activity-panel-trigger"
import { ActivityStatusRow } from "./activity/status-text"

export type AssistantActivityIndicatorProps = {
  presentation: AssistantActivityPresentation
  open: boolean
  onOpenChange?: (open: boolean) => void
  controlsId?: string
  className?: string
}

/** Exhaustive renderer for live, passive, and inspectable assistant activity. */
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
    case "live-status":
      return (
        <div className={className} data-activity-presentation="live-status">
          <ActivityStatusRow
            label={presentation.label}
            shimmer={presentation.motion === "shimmer"}
            className="text-muted-foreground"
          />
        </div>
      )
    case "passive":
      return (
        <ActivityStatusRow
          label={presentation.label}
          shimmer={false}
          className={cn("text-muted-foreground", className)}
          data-activity-presentation="passive"
        />
      )
    case "disclosure":
      return (
        <div
          className={cn("flex min-w-0 items-center gap-2", className)}
          data-activity-presentation="disclosure"
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
