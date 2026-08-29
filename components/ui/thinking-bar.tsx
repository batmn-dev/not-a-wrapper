/**
 * Based on prompt-kit: https://prompt-kit.com/docs/thinking-bar
 * Adds a navigable variant backed by the local TextShimmer primitive.
 */
"use client"

import { Icon } from "@/components/ui/icon"
import { TextShimmer } from "@/components/ui/text-shimmer"
import { cn } from "@/lib/utils"
import { RiArrowRightSLine } from "@remixicon/react"

type ThinkingBarProps = {
  className?: string
  text?: string
  onClick?: () => void
}

export function ThinkingBar({
  className,
  text = "Thinking",
  onClick,
}: ThinkingBarProps) {
  return (
    <div className={cn("flex w-full items-center justify-between", className)}>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="flex items-center gap-1 text-base font-normal transition-opacity hover:opacity-80"
        >
          <TextShimmer className="font-normal">{text}</TextShimmer>
          <Icon
            icon={RiArrowRightSLine}
            slotSize={16}
            className="text-muted-foreground"
          />
        </button>
      ) : (
        <TextShimmer className="cursor-default font-normal">{text}</TextShimmer>
      )}
    </div>
  )
}
