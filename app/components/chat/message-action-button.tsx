"use client"

import { MessageAction } from "@/components/ui/message"
import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

type MessageActionButtonProps = {
  /** aria-label, and the tooltip text unless `tooltip` overrides it. */
  label: string
  /** The glyph (often state-dependent, e.g. copied ? check : copy). */
  icon: ReactNode
  onClick?: () => void
  /** Tooltip text; defaults to `label` (copy actions use "Copied!" when done). */
  tooltip?: ReactNode
  disabled?: boolean
  side?: "top" | "bottom" | "left" | "right"
  delay?: number
  size?: "default" | "branch"
}

/**
 * One message-footer action: the shared tooltip (MessageAction) around the
 * shared icon-button box, with ChatGPT-sized default and branch variants plus
 * the touch-target sizing and muted tokens in one place. Replaces six
 * copy-pasted `<MessageAction><button>…</button>` pairs (copy / edit /
 * regenerate / branch prev+next).
 */
export function MessageActionButton({
  label,
  icon,
  onClick,
  tooltip,
  disabled,
  side = "bottom",
  delay,
  size = "default",
}: MessageActionButtonProps) {
  return (
    <MessageAction tooltip={tooltip ?? label} side={side} delay={delay}>
      <button
        className={cn(
          "text-muted-foreground flex items-center justify-center bg-transparent disabled:pointer-events-none disabled:opacity-50",
          // ChatGPT metrics: standard actions 32×32 / 8px radius; branch-pager
          // steppers 24×30 / 6px radius. Radii are pinned literals — their
          // rounded-lg/rounded-md resolve to 8/6px, ours to 10/8px.
          size === "branch"
            ? "h-[30px] w-[24px] rounded-[6px] pointer-coarse:w-8"
            : "h-8 w-8 rounded-[8px] pointer-coarse:w-10"
        )}
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        type="button"
      >
        {icon}
      </button>
    </MessageAction>
  )
}
