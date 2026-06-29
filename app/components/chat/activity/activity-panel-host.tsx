"use client"

import { cn } from "@/lib/utils"
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"

/**
 * Bridges the Chat-owned `ActivityPanel` to a slot rendered by `LayoutApp`,
 * without moving the scroll column (plan §5 commit 4, GA §7 R4/R6).
 *
 * The bridge shares the slot's DOM element rather than a React node: `Chat`
 * portals the docked shell into that element, so the docked subtree stays in
 * Chat's React tree (props/context intact) while rendering in the layout's
 * sibling track. The element is registered once on mount, so streaming
 * re-renders of the panel never re-render the provider or `Chat`. The slot
 * clears on unmount, so navigating away cannot leave stale panel DOM.
 */
const DockSlotContext = createContext<{
  slotElement: HTMLElement | null
  setSlotElement: (element: HTMLElement | null) => void
} | null>(null)

export function ActivityPanelHostProvider({
  children,
}: {
  children: ReactNode
}) {
  const [slotElement, setSlotElement] = useState<HTMLElement | null>(null)
  // `setSlotElement` (a useState setter) is stable; memoize the value object so
  // consumers only re-render when the element actually changes.
  const value = useMemo(() => ({ slotElement, setSlotElement }), [slotElement])

  return (
    <DockSlotContext.Provider value={value}>
      {children}
    </DockSlotContext.Provider>
  )
}

/** Returns the layout dock slot element, or null until it mounts / after it unmounts. */
export function useActivityPanelDockSlot(): HTMLElement | null {
  return useContext(DockSlotContext)?.slotElement ?? null
}

/**
 * The layout-level dock slot. It is the persistent in-flow width carrier for
 * the desktop flyout: `ActivityPanel` toggles `data-expanded` on this element
 * from a callback ref, so the already-mounted flex track animates `w-0` <->
 * `--activity-panel-width` from the first frame. Portaled content is fixed
 * width and clipped inside this slot, matching the reference stage/screen split.
 */
export function ActivityPanelDockSlot({ className }: { className?: string }) {
  const ctx = useContext(DockSlotContext)
  const setSlotElement = ctx?.setSlotElement

  // Stable ref callback so React only invokes it on mount/unmount (no per-render
  // churn): registers the element on mount, clears it on unmount.
  const ref = useCallback(
    (element: HTMLElement | null) => {
      setSlotElement?.(element)
    },
    [setSlotElement]
  )

  return (
    <div
      ref={ref}
      data-slot="activity-panel-dock"
      data-testid="stage-thread-flyout"
      data-state="closed"
      className={cn(
        // Width is the ONLY animated dimension (the conversation + composer reflow
        // into the freed/used width). Timing is measured from the live reference
        // (research/activity-panel-open-close-animation.md): ChatGPT springs the
        // stage width ~480ms open / ~515ms close with a strong decelerate; the
        // closest single CSS curve is easeOutQuint @ ~500ms. `max-lg:transition-none`
        // keeps the lg-boundary snap instant; `motion-reduce` disables it (the hook
        // also unmounts immediately under reduced motion, so no transitionend is
        // awaited).
        "relative w-0 shrink-0 overflow-hidden transition-[width] duration-[500ms] ease-[cubic-bezier(0.22,1,0.36,1)] max-lg:w-0! max-lg:transition-none motion-reduce:transition-none",
        "data-[expanded]:w-[var(--activity-panel-width)]",
        className
      )}
    />
  )
}
