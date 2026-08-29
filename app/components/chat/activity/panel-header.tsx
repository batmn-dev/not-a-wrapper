"use client"

import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { formatDuration } from "@/lib/format-duration"
import { cn } from "@/lib/utils"
import { RiCloseLargeLine } from "@remixicon/react"
import type { ComponentProps } from "react"

const CLOSE_HOVER_TINT =
  "hover:bg-interactive-hover active:bg-interactive-pressed"

/**
 * PanelCloseButton — the shared ghost-icon close affordance for both panel
 * shells. Owns the Remix close glyph + the translucent hover tint (≈ reference
 * `--surface-hover` #00000012; the ghost variant's opaque `bg-muted` is nearly
 * invisible over the panel surface). The tint is appended AFTER `className` so
 * each shell's layout/visibility delta keeps its exact class order. Use directly
 * with `onClick` (docked header) or as a `SheetClose render` target (sheet) —
 * composed over the unchanged Sheet primitive, never mutating it.
 */
export function PanelCloseButton({
  className,
  children = <Icon icon={RiCloseLargeLine} slotSize={20} />,
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Close"
      className={cn(className, CLOSE_HOVER_TINT)}
      {...props}
    >
      {children}
    </Button>
  )
}

export type TitleDurationClusterProps = {
  title: string
  /** Display-ready duration; omit sub-second values. */
  durationSeconds?: number
  titleId?: string
  className?: string
}

/**
 * TitleDurationCluster — a plain `title · duration` text cluster. It reuses ONLY
 * `formatDuration` from reasoning.tsx; it deliberately does NOT render
 * `Reasoning`/`ReasoningLabel`, which own inline disclosure and auto-open state
 * the panel header must not inherit. Both tiers use `--muted-foreground`.
 */
export function TitleDurationCluster({
  title,
  durationSeconds,
  titleId,
  className,
}: TitleDurationClusterProps) {
  return (
    // Root is a <span> (not <div>) so the cluster is valid phrasing content
    // inside the sheet's <h2> SheetTitle as well as the flyout's flex row.
    // Weight is left to inherit — body 400 on the flyout, font-medium 500 from
    // SheetTitle on the sheet — reproducing the reference's header weight delta.
    <span
      className={cn("flex min-w-0 items-center gap-2.5 text-lg", className)}
    >
      <span id={titleId} className="text-muted-foreground truncate">
        {title}
      </span>
      {durationSeconds !== undefined && durationSeconds > 0 ? (
        <>
          <span aria-hidden className="text-[var(--text-tertiary)]">
            ·
          </span>
          <span className="whitespace-nowrap text-[var(--text-tertiary)]">
            {formatDuration(durationSeconds)}
          </span>
        </>
      ) : null}
    </span>
  )
}

export type PanelHeaderProps = {
  title: string
  durationSeconds?: number
  titleId?: string
  onClose: () => void
  className?: string
}

/**
 * PanelHeader — the docked flyout's header bar: a title/duration cluster plus a
 * close button, aligned to the app conversation header's height and sharp-edge
 * shadow treatment. Its bottom edge is always visible, and it carries the left
 * sharp-edge shadow too because its opaque background would otherwise cover the
 * shell seam. The close button uses the shared ghost icon button and a Remix
 * close glyph tinted by `currentColor`.
 */
export function PanelHeader({
  title,
  durationSeconds,
  titleId,
  onClose,
  className,
}: PanelHeaderProps) {
  return (
    <div
      className={cn(
        "h-app-header flex shrink-0 items-center justify-between gap-2 bg-[var(--activity-panel-surface)] px-4 [box-shadow:var(--sharp-edge-top-shadow)]",
        className
      )}
    >
      <TitleDurationCluster
        title={title}
        durationSeconds={durationSeconds}
        titleId={titleId}
      />
      <PanelCloseButton
        data-testid="close-button"
        className="-me-2.5 rounded-md"
        onClick={onClose}
      />
    </div>
  )
}
