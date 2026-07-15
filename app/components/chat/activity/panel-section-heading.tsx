import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

export type PanelSectionHeadingProps = {
  title: string
  /** Trailing slot — e.g. `· {count}`. Rendered muted and nowrap. */
  trailing?: ReactNode
  className?: string
}

/**
 * PanelSectionHeading — a muted section label for the Activity panel body
 * (e.g. "Sources · 12"). A plain `div`, NOT a heading element: the panel's
 * accessible name lives on the dialog/landmark header, so a second heading
 * here would pollute the a11y tree (GA §D1, plan §B). Uses the activity panel's
 * reference section scale: 1.05rem / 1.5, medium.
 */
export function PanelSectionHeading({
  title,
  trailing,
  className,
}: PanelSectionHeadingProps) {
  return (
    <div
      className={cn(
        "text-muted-foreground flex min-h-6 w-full items-baseline justify-between gap-3 text-[1.05rem] leading-[1.5] font-medium",
        className
      )}
    >
      <span className="min-w-0 truncate">{title}</span>
      {trailing != null ? (
        <span className="shrink-0 font-normal whitespace-nowrap text-[var(--text-tertiary)]">
          {trailing}
        </span>
      ) : null}
    </div>
  )
}
