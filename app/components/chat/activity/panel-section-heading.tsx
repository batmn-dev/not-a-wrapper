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
 * here would pollute the a11y tree (GA §D1, plan §B). Uses stock `text-base`
 * + `font-medium` rather than the reference's arbitrary `text-[1.05rem]`
 * (GA §4 row 32).
 */
export function PanelSectionHeading({
  title,
  trailing,
  className,
}: PanelSectionHeadingProps) {
  return (
    <div
      className={cn(
        "text-muted-foreground flex items-baseline justify-between text-base font-medium",
        className
      )}
    >
      <span className="truncate">{title}</span>
      {trailing != null ? (
        <span className="text-muted-foreground/70 shrink-0 font-normal whitespace-nowrap">
          {trailing}
        </span>
      ) : null}
    </div>
  )
}
