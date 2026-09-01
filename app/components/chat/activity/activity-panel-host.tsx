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
 * Bridges the Chat-owned `ActivityPanel` to the FloatingContent slot rendered
 * beside `#main` inside LayoutApp's scroll root.
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
      data-stage-thread-flyout=""
      data-slot="activity-panel-dock"
      data-testid="stage-thread-flyout"
      data-state="closed"
      className={cn(
        // Width is the only animated dimension, so the conversation and composer
        // reflow continuously. The linear() curve approximates a no-overshoot spring.
        // `max-lg:transition-none` keeps the lg-boundary snap instant; `motion-reduce`
        // disables it (the hook also unmounts immediately under reduced motion, so no
        // transitionend is awaited).
        "bg-background relative z-1 w-0 shrink-0 overflow-x-hidden transition-[width] duration-[520ms] ease-[linear(0,0.0377,0.1243,0.2318,0.3434,0.4497,0.5459,0.6299,0.7017,0.7619,0.8117,0.8523,0.8853,0.9118,0.9329,0.9497,0.963,0.9735,0.9817,0.9881,0.9931,0.997,1)] motion-reduce:transition-none max-lg:w-0! max-lg:transition-none",
        "data-[expanded]:w-[var(--activity-panel-width)]",
        className
      )}
    />
  )
}
