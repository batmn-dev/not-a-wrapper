"use client"

import { MessageAction } from "@/components/ui/message"
import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

type MessageActionButtonProps = {
  label: string
  icon: ReactNode
  onClick?: () => void
  tooltip?: ReactNode
  disabled?: boolean
  disabledReason?: ReactNode
  side?: "top" | "bottom" | "left" | "right"
  size?: "default" | "branch"
}

/** Shared message-footer action with tooltip and disabled-reason handling. */
export function MessageActionButton({
  label,
  icon,
  onClick,
  tooltip,
  disabled,
  disabledReason,
  side = "bottom",
  size = "default",
}: MessageActionButtonProps) {
  return (
    <MessageAction tooltip={disabledReason ?? tooltip ?? label} side={side}>
      <button
        className={cn(
          "text-muted-foreground flex items-center justify-center bg-transparent disabled:pointer-events-none disabled:opacity-50 aria-disabled:opacity-50",
          // Reference metrics: standard actions 32×32 / 8px radius; branch-pager
          // steppers 24×30 / 6px radius. Radii are pinned literals — their
          // rounded-lg/rounded-md resolve to 8/6px, ours to 10/8px.
          size === "branch"
            ? "h-[30px] w-[24px] rounded-[6px] pointer-coarse:w-8"
            : "h-8 w-8 rounded-[8px] pointer-coarse:w-10"
        )}
        aria-label={label}
        aria-disabled={disabledReason ? true : undefined}
        onClick={disabledReason ? undefined : onClick}
        disabled={disabled}
        type="button"
      >
        {icon}
      </button>
    </MessageAction>
  )
}
