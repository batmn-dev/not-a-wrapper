"use client"

import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { useId, type ReactNode, type RefObject } from "react"
import { PanelHeader } from "./panel-header"

export type DockedFlyoutShellProps = {
  panelId?: string
  title: string
  durationSeconds?: number
  active: boolean
  onClose: () => void
  children: ReactNode
  /**
   * Forwarded to the scroll viewport for auto-scroll on stream. Intentional
   * scaffolding — `ActivityPanel` does not pass it yet (kept, not dead). Ref
   * grounding: PARTIAL — the scroll container + trailing `scroll-mb-4` spacer
   * exist, but live scroll-to-bottom-on-stream is not observable in the static
   * capture. See TODO.md ("Chat side panel").
   */
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
 *
 * The shell is pinned to a FIXED `--activity-panel-width` (it does NOT fill the
 * animating slot): the slot's `overflow-hidden` clips it while the slot width
 * animates `0 <-> --activity-panel-width`, so the content slides/clips and never
 * re-wraps mid-animation (matches the reference's fixed-width clipped flyout).
 * The start seam (`border-s`) lives here too, so it slides with the content
 * instead of popping on the slot.
 */
export function DockedFlyoutShell({
  panelId,
  title,
  durationSeconds,
  active,
  onClose,
  children,
  viewportRef,
  className,
}: DockedFlyoutShellProps) {
  const titleId = useId()

  return (
    <section
      id={panelId}
      aria-labelledby={titleId}
      aria-hidden={active ? undefined : true}
      inert={active ? undefined : true}
      className={cn(
        "bg-card text-foreground border-border flex h-full w-[var(--activity-panel-width)] flex-col border-s",
        className
      )}
    >
      <PanelHeader
        title={title}
        durationSeconds={durationSeconds}
        titleId={titleId}
        panelId={panelId}
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
