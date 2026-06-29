"use client"

import { usePrefersReducedMotion } from "@/app/hooks/use-prefers-reduced-motion"
import { useCallback, useRef, useState } from "react"

export const DOCKED_PANEL_CLOSE_FALLBACK_MS = 700

/**
 * useDockedPanelCollapse — keeps the docked Activity flyout mounted through its
 * close collapse so it slides shut populated (reference parity) instead of
 * vanishing in one frame. The layout dock slot owns the width transition; this
 * hook toggles its attributes from the portaled content callback ref so the
 * persistent in-flow track animates from the first frame. Keep the
 * adjust-during-render derivation: pushing this into an effect reintroduces a
 * one-frame open/close flash.
 *
 * `dockedExpanded` is the OPEN state of the docked shell (`open && !isBelowLg`).
 * Returns `dockedPresent`: whether the shell should be in the tree right now —
 * true while open AND while closing, until the slot's width transition ends.
 */
export function useDockedPanelCollapse({
  slotElement,
  dockedExpanded,
  isBelowLg,
}: {
  slotElement: HTMLElement | null
  dockedExpanded: boolean
  isBelowLg: boolean
}): {
  dockedPresent: boolean
  onDockedContentRef: (element: HTMLElement | null) => void
} {
  // Keep the docked shell mounted through the close collapse so it slides shut
  // populated (reference parity) instead of vanishing in one frame. `closing`
  // stays true from collapse-start until the slot width transition ends; the
  // shell unmounts once it clears. We only defer for an animated close (>=lg,
  // motion allowed) — otherwise no width transition (and no `transitionend`)
  // fires, so we unmount immediately by never entering `closing`.
  const reducedMotion = usePrefersReducedMotion()
  const [closing, setClosing] = useState(false)
  const [wasExpanded, setWasExpanded] = useState(dockedExpanded)
  const cleanupCloseRef = useRef<(() => void) | null>(null)
  const cleanupClose = useCallback(() => {
    cleanupCloseRef.current?.()
    cleanupCloseRef.current = null
  }, [])
  const finishClosing = useCallback(() => {
    cleanupClose()
    setClosing(false)
  }, [cleanupClose])

  if (wasExpanded !== dockedExpanded) {
    // Adjust-during-render (no effect): the panel just opened or began closing.
    setWasExpanded(dockedExpanded)
    setClosing(
      !dockedExpanded && slotElement !== null && !isBelowLg && !reducedMotion
    )
  } else if (
    closing &&
    (dockedExpanded || slotElement === null || isBelowLg || reducedMotion)
  ) {
    setClosing(false)
  }
  const dockedPresent = dockedExpanded || closing

  const onDockedContentRef = useCallback(
    (element: HTMLElement | null) => {
      cleanupClose()

      if (!slotElement) return

      if (!element) {
        slotElement.removeAttribute("data-expanded")
        slotElement.setAttribute("data-state", "closed")
        return
      }

      if (closing) {
        const onEnd = (event: TransitionEvent) => {
          if (event.target === slotElement && event.propertyName === "width") {
            finishClosing()
          }
        }
        const fallback = window.setTimeout(
          finishClosing,
          DOCKED_PANEL_CLOSE_FALLBACK_MS
        )
        slotElement.addEventListener("transitionend", onEnd)
        cleanupCloseRef.current = () => {
          slotElement.removeEventListener("transitionend", onEnd)
          window.clearTimeout(fallback)
        }
      }

      if (dockedExpanded) {
        slotElement.setAttribute("data-expanded", "")
        slotElement.setAttribute("data-state", "open")
      } else {
        slotElement.removeAttribute("data-expanded")
        slotElement.setAttribute("data-state", "closed")
      }
    },
    [cleanupClose, closing, dockedExpanded, finishClosing, slotElement]
  )

  return {
    dockedPresent,
    onDockedContentRef,
  }
}
