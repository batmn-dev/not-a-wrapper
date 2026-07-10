"use client"

import { MessageAction } from "@/components/ui/message"
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
}

/**
 * One message-footer action: the shared tooltip (MessageAction) around the
 * shared 32px icon-button box, with the touch-target sizing and muted tokens in
 * one place. Replaces six copy-pasted `<MessageAction><button>…</button>`
 * pairs (copy / edit / regenerate / branch prev+next). The `disabled:` classes
 * are inert unless `disabled`, so the non-branch buttons render unchanged.
 */
export function MessageActionButton({
  label,
  icon,
  onClick,
  tooltip,
  disabled,
  side = "bottom",
  delay,
}: MessageActionButtonProps) {
  return (
    <MessageAction tooltip={tooltip ?? label} side={side} delay={delay}>
      <button
        className="text-muted-foreground disabled:text-muted-foreground/40 flex h-8 w-8 items-center justify-center rounded-md bg-transparent disabled:pointer-events-none pointer-coarse:h-10 pointer-coarse:w-10"
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
