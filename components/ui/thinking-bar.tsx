/**
 * @component ThinkingBar
 * @source prompt-kit
 * @upstream https://prompt-kit.com/docs/thinking-bar
 * @customized true
 * @customizations
 *   - Adds `onClick` prop for navigation/expansion functionality
 *   - Shows ChevronRight icon on hover when onClick is provided
 *   - Upstream only has `onStop` prop; Not A Wrapper adds clickable thinking text
 *   - Uses local TextShimmer component (also customized)
 * @upgradeNotes
 *   - Preserve onClick prop and ChevronRight icon rendering
 *   - Maintain conditional button vs span rendering based on onClick
 *   - Verify TextShimmer import path remains correct
 */
"use client"
import { RiArrowRightSLine } from "@remixicon/react"

import { TextShimmer } from "@/components/ui/text-shimmer"
import { cn } from "@/lib/utils"

type ThinkingBarProps = {
  className?: string
  text?: string
  onStop?: () => void
  stopLabel?: string
  onClick?: () => void
}

export function ThinkingBar({
  className,
  text = "Thinking",
  // Keep `onStop` in the API for compatibility; we may restore a stop CTA later.
  onStop: _onStop,
  stopLabel = "Answer now",
  onClick,
}: ThinkingBarProps) {
  // TODO: Potentially re-add a stop/answer CTA after clarifying UX semantics.
  void stopLabel
  return (
    <div className={cn("flex w-full items-center justify-between", className)}>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="flex items-center gap-1 text-base transition-opacity hover:opacity-80"
        >
          <TextShimmer className="font-medium">{text}</TextShimmer>
          <RiArrowRightSLine size={16} className="text-muted-foreground" />
        </button>
      ) : (
        <TextShimmer className="cursor-default font-medium">{text}</TextShimmer>
      )}
    </div>
  )
}
