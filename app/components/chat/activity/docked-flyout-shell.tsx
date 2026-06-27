"use client"

import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { useId, type ReactNode, type RefObject } from "react"
import { PanelHeader } from "./panel-header"

export type DockedFlyoutShellProps = {
  title: string
  durationSeconds?: number
  onClose: () => void
  children: ReactNode
  /** Forwarded to the scroll viewport for auto-scroll on stream. */
  viewportRef?: RefObject<HTMLDivElement | null>
  className?: string
}

/**
 * DockedFlyoutShell — the ≥lg in-flow panel (plan §5 commit 4, GA §A2, §7 R9).
 * A landmark `<section>` labelled by the visible panel title, NOT a dialog: no
 * backdrop, no focus trap, no scroll-lock, ESC inert. It pushes the conversation
 * (width lives on the layout dock slot) and is opaque (`bg-card`) so nothing
 * bleeds through. Reuses the shipped `Button(ghost, icon-sm)` close (via
 * PanelHeader) and a ScrollArea body with a trailing scroll spacer.
 */
export function DockedFlyoutShell({
  title,
  durationSeconds,
  onClose,
  children,
  viewportRef,
  className,
}: DockedFlyoutShellProps) {
  const titleId = useId()

  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        "bg-card text-foreground flex h-full w-full flex-col",
        className
      )}
    >
      <PanelHeader
        title={title}
        durationSeconds={durationSeconds}
        titleId={titleId}
        onClose={onClose}
      />
      <ScrollArea viewportRef={viewportRef} className="min-h-0 flex-1">
        <div className="px-2 py-3">{children}</div>
        {/* Desktop reference uses scroll margin instead of visible tail padding. */}
        <div aria-hidden className="scroll-mb-4" />
      </ScrollArea>
    </section>
  )
}
