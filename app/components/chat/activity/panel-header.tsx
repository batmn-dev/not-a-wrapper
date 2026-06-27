"use client"

import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { formatDuration } from "@/components/ui/reasoning"
import { cn } from "@/lib/utils"
import { RiCloseLine } from "@remixicon/react"

export type TitleDurationClusterProps = {
  title: string
  durationSeconds?: number
  className?: string
}

/**
 * TitleDurationCluster — a plain `title · duration` text cluster. It reuses ONLY
 * `formatDuration` from reasoning.tsx; it deliberately does NOT render
 * `Reasoning`/`ReasoningLabel`, which own inline disclosure + React-19 auto-open
 * state the panel header must not inherit (plan §6, GA §B2). Both tiers collapse
 * onto `--muted-foreground` (GA §6.5).
 */
export function TitleDurationCluster({
  title,
  durationSeconds,
  className,
}: TitleDurationClusterProps) {
  return (
    // Root is a <span> (not <div>) so the cluster is valid phrasing content
    // inside the sheet's <h2> SheetTitle as well as the flyout's flex row.
    // Weight is left to inherit — body 400 on the flyout, font-medium 500 from
    // SheetTitle on the sheet — reproducing the reference's header weight delta.
    <span
      className={cn(
        "flex min-w-0 items-baseline gap-2.5 text-lg",
        className
      )}
    >
      <span className="text-muted-foreground truncate">{title}</span>
      {durationSeconds !== undefined ? (
        <>
          <span aria-hidden className="text-muted-foreground/70">
            ·
          </span>
          <span className="text-muted-foreground/70 whitespace-nowrap">
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
  onClose: () => void
  className?: string
}

/**
 * PanelHeader — the docked flyout's header bar: a title/duration cluster plus a
 * close button, pinned to `--spacing-panel-header` (56px). The close button is
 * the shipped `Button(ghost, icon-sm)` with a Remix close glyph tinted by
 * `currentColor` — no new file, no sprite hash (GA §4 row 22).
 */
export function PanelHeader({
  title,
  durationSeconds,
  onClose,
  className,
}: PanelHeaderProps) {
  return (
    <div
      className={cn(
        "flex h-[var(--spacing-panel-header)] shrink-0 items-center justify-between gap-2 border-b border-border px-4",
        className
      )}
    >
      <TitleDurationCluster title={title} durationSeconds={durationSeconds} />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Close"
        onClick={onClose}
      >
        <Icon icon={RiCloseLine} slotSize={16} />
      </Button>
    </div>
  )
}
