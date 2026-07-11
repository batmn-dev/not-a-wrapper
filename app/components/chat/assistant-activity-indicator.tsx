"use client"

import type { AssistantActivityPresentation } from "@/lib/chat-messages/assistant-activity"
import { cn } from "@/lib/utils"
import { ActivityPanelTrigger } from "./activity/activity-panel-trigger"
import { StatusText } from "./activity/status-text"

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
          <StatusText
            label={presentation.label}
            shimmer={presentation.motion === "shimmer"}
            className="text-muted-foreground"
          />
        </div>
      )
    case "passive":
      return (
        <span
          className={cn(
            "text-muted-foreground text-base leading-6 font-normal",
            className
          )}
          data-activity-presentation="passive"
        >
          {presentation.label}
        </span>
      )
    case "disclosure":
      return (
        <div
          className={cn("flex min-w-0 items-center gap-2", className)}
          data-activity-presentation="disclosure"
        >
          {presentation.passiveLabel ? (
            <span className="text-muted-foreground text-base leading-6 font-normal">
              {presentation.passiveLabel}
            </span>
          ) : null}
          {onOpenChange ? (
            <ActivityPanelTrigger
              open={open}
              onOpenChange={onOpenChange}
              controlsId={controlsId}
              presentation={presentation}
            />
          ) : (
            <StatusText
              label={presentation.label}
              shimmer={presentation.motion === "shimmer"}
              className="text-muted-foreground"
            />
          )}
        </div>
      )
  }
}
