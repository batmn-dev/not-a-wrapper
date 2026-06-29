"use client"

import { usePrefersReducedMotion } from "@/app/hooks/use-prefers-reduced-motion"
import { useCallback, useRef, useState, type TransitionEvent } from "react"

export const DOCKED_PANEL_CLOSE_FALLBACK_MS = 700

/**
 * useDockedPanelCollapse — keeps the docked Activity flyout mounted through its
 * close collapse so it slides shut populated (reference parity) instead of
 * vanishing in one frame. The portaled flyout wrapper owns the width transition
 * and calls `onDockedTransitionEnd`; the layout dock slot stays a plain portal
 * target. Keep the adjust-during-render derivation: pushing this into an effect
 * reintroduces a one-frame open/close flash.
 *
 * `dockedExpanded` is the OPEN state of the docked shell (`open && !isBelowLg`).
 * Returns `dockedPresent`: whether the shell should be in the tree right now —
 * true while open AND while closing, until the wrapper's width transition ends.
 */
export function useDockedPanelCollapse({
  dockedExpanded,
  isBelowLg,
  hasDockSlot = true,
}: {
  dockedExpanded: boolean
  isBelowLg: boolean
  hasDockSlot?: boolean
}): {
  dockedPresent: boolean
  dockedState: "open" | "closed"
  onDockedStageRef: (element: HTMLElement | null) => void
  onDockedTransitionEnd: (event: TransitionEvent<HTMLElement>) => void
} {
  // Keep the docked shell mounted through the close collapse so it slides shut
  // populated (reference parity) instead of vanishing in one frame. `closing`
  // stays true from collapse-start until the wrapper width transition ends; the
  // shell unmounts once it clears. We only defer for an animated close (>=lg,
  // motion allowed) — otherwise no width transition (and no `transitionend`)
  // fires, so we unmount immediately by never entering `closing`.
  const reducedMotion = usePrefersReducedMotion()
  const [closing, setClosing] = useState(false)
  const [wasExpanded, setWasExpanded] = useState(dockedExpanded)
  const fallbackTimeoutRef = useRef<number | null>(null)
  const clearFallbackTimeout = useCallback(() => {
    if (fallbackTimeoutRef.current === null) return
    window.clearTimeout(fallbackTimeoutRef.current)
    fallbackTimeoutRef.current = null
  }, [])
  const finishClosing = useCallback(() => {
    clearFallbackTimeout()
    setClosing(false)
  }, [clearFallbackTimeout])

  if (wasExpanded !== dockedExpanded) {
    // Adjust-during-render (no effect): the panel just opened or began closing.
    setWasExpanded(dockedExpanded)
    setClosing(!dockedExpanded && hasDockSlot && !isBelowLg && !reducedMotion)
  } else if (
    closing &&
    (dockedExpanded || !hasDockSlot || isBelowLg || reducedMotion)
  ) {
    setClosing(false)
  }
  const dockedPresent = dockedExpanded || closing
  const dockedState = dockedExpanded ? "open" : "closed"

  const onDockedStageRef = useCallback(
    (element: HTMLElement | null) => {
      clearFallbackTimeout()
      if (!element || !closing) return
      fallbackTimeoutRef.current = window.setTimeout(() => {
        fallbackTimeoutRef.current = null
        setClosing(false)
      }, DOCKED_PANEL_CLOSE_FALLBACK_MS)
    },
    [clearFallbackTimeout, closing]
  )

  const onDockedTransitionEnd = useCallback(
    (event: TransitionEvent<HTMLElement>) => {
      if (
        event.currentTarget === event.target &&
        event.propertyName === "width"
      ) {
        finishClosing()
      }
    },
    [finishClosing]
  )

  return {
    dockedPresent,
    dockedState,
    onDockedStageRef,
    onDockedTransitionEnd,
  }
}
