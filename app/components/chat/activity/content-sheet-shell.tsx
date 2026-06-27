"use client"

import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { RiCloseLine } from "@remixicon/react"
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
        showCloseButton={false}
        overlayClassName={OVERLAY_CLASSNAME}
        className={cn(
          // Mobile: bottom sheet, rounded top / squared bottom, close hidden
          // (the handle + backdrop are the dismiss affordances). `max-sm:shadow-none`
          // suppresses the Sheet primitive's unconditional `shadow-border-lg`
          // (sheet.tsx) below `sm` — the reference mobile sheet is flush against a
          // flat scrim with NO elevation; `sm:shadow-border-xl` (below) restores
          // the closest existing floating shadow token on the tablet card. Both
          // write `--tw-shadow` at equal specificity and the `max-sm` variant sorts
          // later, so no `!` is needed (compile-verified).
          // Max height matches the reference sheet/card: full height minus a 6px
          // (or safe-area) top gap, so long reasoning + a large gallery use the
          // available height instead of capping at 85% and leaving dead scrim.
          "grid h-fit max-h-[calc(100%_-_max(env(safe-area-inset-top),6px))] grid-rows-[min-content_minmax(0,1fr)] gap-0 overflow-hidden rounded-t-[16px] pb-4 max-sm:shadow-none",
          // Tablet (sm): centered card without top/bottom inset stretch.
          "sm:shadow-border-xl sm:top-1/2 sm:right-auto! sm:bottom-auto! sm:left-1/2! sm:h-fit sm:max-h-[calc(100%_-_max(env(safe-area-inset-top),6px))] sm:w-[28rem] sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[16px]",
          // Enter/exit timing (GA §6.2): edge slide, ~250ms in / 200ms out,
          // committed curve; all gated by motion-reduce (new repo pattern).
          "ease-[cubic-bezier(0.32,0.72,0,1)] data-ending-style:duration-200 data-starting-style:duration-[250ms] motion-reduce:transition-none",
          className
        )}
      >
        {/* Mobile-only drag handle; decorative (the Sheet handles dismissal). */}
        <div
          aria-hidden
          className="bg-muted mx-auto mt-1.5 h-1 w-12 shrink-0 rounded-full sm:hidden"
        />
        <section className="flex max-h-[calc(100svh_-_max(env(safe-area-inset-top),6px)_-_16px)] min-h-0 min-w-0 flex-col overflow-hidden">
          {/* The cluster IS the dialog's accessible name; the `·` span is
              aria-hidden, so the name reads "Activity 5m 42s". */}
          <header className="grid min-h-[var(--spacing-panel-header)] grid-cols-[minmax(0,1fr)_min-content] items-center gap-3 ps-6 pe-4 pt-4 pb-2 select-none">
            <SheetTitle className="m-0 min-w-0 overflow-hidden text-lg leading-7">
              <TitleDurationCluster
                title={title}
                durationSeconds={durationSeconds}
              />
            </SheetTitle>
            <SheetClose
              aria-label="Close"
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-md p-1 max-sm:hidden"
                />
              }
            >
              <Icon icon={RiCloseLine} slotSize={20} />
            </SheetClose>
          </header>
          {children}
        </section>
      </SheetContent>
    </Sheet>
  )
}
