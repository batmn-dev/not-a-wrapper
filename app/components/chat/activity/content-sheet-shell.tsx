"use client"

import { Icon } from "@/components/ui/icon"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { RiCloseLargeLine } from "@remixicon/react"
import type { ReactNode } from "react"
import { PanelCloseButton, TitleDurationCluster } from "./panel-header"

/**
 * Override the shared Sheet overlay per breakpoint: mobile has no blur or
 * transition; tablet has a 1px blur and fade. Important modifiers beat the
 * primitive and keep reduced motion authoritative after Tailwind sorting.
 */
const OVERLAY_CLASSNAME = cn(
  // Mobile: flat scrim, no blur, instant (force the primitive's blur off).
  "bg-[var(--overlay-scrim-mobile)] max-sm:backdrop-blur-[0px]! max-sm:transition-none",
  // Tablet (sm): tinted scrim + 1px blur + 250ms opacity fade.
  "sm:bg-[var(--overlay-scrim-tablet)] sm:backdrop-blur-[1px]! sm:transition-opacity sm:duration-[250ms] sm:data-starting-style:opacity-0",
  // Suppress the tablet fade under reduced motion (needs `!`; see note above).
  "motion-reduce:transition-none!"
)

export type ContentSheetShellProps = {
  panelId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** Elapsed reasoning time; rendered as the tertiary `· {duration}` tier. */
  durationSeconds?: number
  children: ReactNode
  className?: string
}

/** Mobile bottom sheet and tablet centered card over the shared Sheet API. */
export function ContentSheetShell({
  panelId,
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
        id={panelId}
        aria-modal="true"
        side="bottom"
        showCloseButton={false}
        overlayClassName={OVERLAY_CLASSNAME}
        className={cn(
          // Mobile: bottom sheet, rounded top / squared bottom, close hidden
          // (the handle + backdrop are the dismiss affordances). `max-sm:shadow-none`
          // suppresses the Sheet primitive's unconditional `shadow-border-lg`
          // (sheet.tsx) below `sm` — the reference mobile sheet is flush against a
          // flat scrim with NO elevation. Tablet uses the scoped measured shadow
          // token below instead of the generic Sheet elevation.
          // Max height matches the reference sheet/card: full height minus a 6px
          // (or safe-area) top gap, so long reasoning + a large gallery use the
          // available height instead of capping at 85% and leaving dead scrim.
          "grid h-fit max-h-[calc(100%_-_max(env(safe-area-inset-top),6px))] grid-rows-[min-content_minmax(0,1fr)] gap-0 overflow-hidden rounded-t-[16px] pb-4 max-sm:right-auto! max-sm:left-1/2! max-sm:w-[min(100vw,28rem)] max-sm:-translate-x-1/2 max-sm:shadow-none",
          // Tablet (sm): centered card without top/bottom inset stretch.
          "sm:top-1/2 sm:right-auto! sm:bottom-auto! sm:left-1/2! sm:h-fit sm:max-h-[calc(100%_-_max(env(safe-area-inset-top),6px))] sm:w-[28rem] sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[16px] sm:[box-shadow:var(--activity-sheet-shadow)]",
          // Enter/exit timing from the live panel pass: mobile/sheet opens in
          // roughly 335-390ms and closes slower (~480ms). Tablet backdrop keeps
          // its separate 250ms opacity fade above.
          "duration-[360ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-ending-style:duration-[480ms] data-starting-style:duration-[360ms] motion-reduce:transition-none",
          className
        )}
      >
        {/* Mobile-only drag handle; decorative (the Sheet handles dismissal). */}
        <div
          data-testid="chat-screen-cot-mobile-sheet-handle"
          aria-hidden
          className="bg-muted mx-auto mt-1.5 h-1 w-12 shrink-0 rounded-full sm:hidden"
        />
        <section className="flex h-[80vh] max-h-[calc(100svh_-_max(env(safe-area-inset-top),6px)_-_16px)] min-h-0 min-w-0 flex-col overflow-hidden sm:h-auto">
          {/* The cluster IS the dialog's accessible name; the `·` span is
              aria-hidden, so the name reads "Activity 5m 42s". */}
          <header className="grid min-h-[var(--spacing-panel-header)] grid-cols-[minmax(0,1fr)_min-content] items-center gap-3 ps-6 pe-4 pt-4 pb-2 select-none">
            <SheetTitle
              data-testid="chat-screen-cot-mobile-sheet-title-focus-target"
              tabIndex={-1}
              className="m-0 min-w-0 overflow-hidden text-lg leading-7"
            >
              <TitleDurationCluster
                title={title}
                durationSeconds={durationSeconds}
              />
            </SheetTitle>
            <SheetClose
              aria-label="Close"
              render={
                <PanelCloseButton
                  data-testid="close-button"
                  className="rounded-md p-1 max-sm:hidden"
                />
              }
            >
              <Icon icon={RiCloseLargeLine} slotSize={20} />
            </SheetClose>
          </header>
          {children}
        </section>
      </SheetContent>
    </Sheet>
  )
}
