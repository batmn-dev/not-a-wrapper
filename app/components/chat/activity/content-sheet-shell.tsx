"use client"

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import type { ReactNode } from "react"
import { TitleDurationCluster } from "./panel-header"

/**
 * Breakpoint scrim (GA §C3, §6.2, §7 R7): mobile black/30, NO blur, instant;
 * tablet (sm) gray/50 (light) or black/50 (dark) with a 1px blur and a 250ms
 * fade. This is the ONLY behavior that needs the additive `overlayClassName`.
 *
 * The Sheet primitive's overlay applies `supports-backdrop-filter:backdrop-blur-xs`
 * unconditionally; the reference mobile sheet has no blur. We can't edit the
 * primitive (compose-don't-mutate), so the per-breakpoint blur is set with `!`
 * over disjoint media queries: `max-sm` forces it off, `sm` pins 1px — neither
 * relies on cascade order against the primitive's base. `max-sm:transition-none`
 * makes the mobile entrance instant; `motion-reduce:transition-none!` suppresses
 * the tablet fade — it needs `!` because the `sm:transition-opacity` we add here
 * sorts AFTER the plain motion-reduce rule at equal specificity and would
 * otherwise win under prefers-reduced-motion at >=640px.
 */
const OVERLAY_CLASSNAME =
  "bg-[var(--overlay-scrim-mobile)] max-sm:backdrop-blur-[0px]! max-sm:transition-none sm:bg-[var(--overlay-scrim-tablet)] sm:backdrop-blur-[1px]! sm:transition-opacity sm:duration-[250ms] sm:data-starting-style:opacity-0 motion-reduce:transition-none!"

export type ContentSheetShellProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** Elapsed reasoning time; rendered as the tertiary `· {duration}` tier. */
  durationSeconds?: number
  children: ReactNode
  className?: string
}

/**
 * ContentSheetShell — the `<lg` Activity panel shell, composed entirely over the
 * existing Sheet public API (plan §5 commit 2, GA §7 R2). Mobile: a bottom sheet
 * with a drag handle and a hidden close (dismiss via the handle/backdrop).
 * Tablet (`sm`): a centered card with the close button shown.
 *
 * The ONLY primitive change is the additive `overlayClassName`; sheet.tsx
 * defaults stay byte-identical. Per fix-overlay-bleedthrough discipline the
 * surface stays opaque (the primitive's `bg-popover`) — the scrim is applied to
 * the backdrop only, never retinted onto the surface.
 */
export function ContentSheetShell({
  open,
  onOpenChange,
  title,
  durationSeconds,
  children,
  className,
}: ContentSheetShellProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        overlayClassName={OVERLAY_CLASSNAME}
        className={cn(
          // Mobile: bottom sheet, rounded top / squared bottom, close hidden
          // (the handle + backdrop are the dismiss affordances).
          "max-h-[85svh] rounded-t-2xl [&>button]:max-sm:hidden",
          // Tablet (sm): centered card via fixed-inset auto-margins.
          "sm:inset-0 sm:m-auto sm:h-fit sm:max-h-[85svh] sm:max-w-md sm:rounded-2xl sm:shadow-border-lg",
          // Enter/exit timing (GA §6.2): edge slide, ~250ms in / 200ms out,
          // committed curve; all gated by motion-reduce (new repo pattern).
          "ease-[cubic-bezier(0.32,0.72,0,1)] data-starting-style:duration-[250ms] data-ending-style:duration-200 motion-reduce:transition-none",
          className
        )}
      >
        {/* Mobile-only drag handle; decorative (the Sheet handles dismissal). */}
        <div
          aria-hidden
          className="bg-muted mx-auto mt-4 h-1 w-12 shrink-0 rounded-full sm:hidden"
        />
        {/* The cluster IS the dialog's accessible name; the `·` span is
            aria-hidden, so the name reads "Activity 5m 42s". */}
        <SheetTitle className="px-6 pt-2 sm:pt-4">
          <TitleDurationCluster
            title={title}
            durationSeconds={durationSeconds}
          />
        </SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  )
}
