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
  const value = useMemo(
    () => ({ slotElement, setSlotElement }),
    [slotElement]
  )

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
 * The layout-level dock slot. Its width follows its content: empty (panel
 * closed or below lg) collapses to `w-0`; once the docked shell is portaled in
 * it expands to `--activity-panel-width` with an animated, motion-reduce-gated
 * push. Border/background are gated on content so a closed panel leaves no
 * stray seam.
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
      className={cn(
        "w-0 shrink-0 overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none",
        "[&:not(:empty)]:border-border [&:not(:empty)]:w-[var(--activity-panel-width)] [&:not(:empty)]:border-s",
        className
      )}
    />
  )
}
