"use client"

import type { AssistantActivityPresentation } from "@/lib/chat-messages/assistant-activity"
import { cn } from "@/lib/utils"
import { ActivityPanelTrigger } from "./activity/activity-panel-trigger"
import { ActivityStatusRow, StatusText } from "./activity/status-text"

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
    case "live-status": {
      if (presentation.semanticKind !== "thinking") {
        return (
          <div className={className} data-activity-presentation="live-status">
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
            "flex min-h-8 max-w-full shrink-0 items-start gap-2 text-start text-base leading-6 text-[var(--text-tertiary)]",
            className
          )}
          data-activity-presentation="live-status"
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
