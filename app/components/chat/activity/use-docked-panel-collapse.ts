"use client"

import { usePrefersReducedMotion } from "@/app/hooks/use-prefers-reduced-motion"
import { useEffect, useState } from "react"

/**
 * useDockedPanelCollapse — keeps the docked Activity flyout mounted through its
 * close collapse so it slides shut populated (reference parity) instead of
 * vanishing in one frame. Relocated verbatim from `ActivityPanel`; the logic is
 * load-bearing (motion guardrails) — do NOT turn the adjust-during-render
 * derivation into an effect (that reintroduces a one-frame open/close flash),
 * and keep the `!reducedMotion` short-circuit (no transition ⇒ no
 * `transitionend` ⇒ must not enter the `closing` window).
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
}): { dockedPresent: boolean } {
  // Drive the slot width by the OPEN state, imperatively, so toggling the panel
  // never re-renders the layout provider or Chat. The slot animates
  // `w-0 <-> --activity-panel-width` off this attribute.
  useEffect(() => {
    const el = slotElement
    if (!el) return
    if (dockedExpanded) el.setAttribute("data-expanded", "")
    else el.removeAttribute("data-expanded")
  }, [slotElement, dockedExpanded])

  // Keep the docked shell mounted through the close collapse so it slides shut
  // populated (reference parity) instead of vanishing in one frame. `closing`
  // stays true from collapse-start until the slot's width transition ends; the
  // shell unmounts once it clears. We only defer for an animated close (>=lg,
  // motion allowed) — otherwise no width transition (and no `transitionend`)
  // fires, so we unmount immediately by never entering `closing`.
  const reducedMotion = usePrefersReducedMotion()
  const [closing, setClosing] = useState(false)
  const [wasExpanded, setWasExpanded] = useState(dockedExpanded)
  if (wasExpanded !== dockedExpanded) {
    // Adjust-during-render (no effect): the panel just opened or began closing.
    setWasExpanded(dockedExpanded)
    setClosing(!dockedExpanded && !isBelowLg && !reducedMotion)
  }
  const dockedPresent = dockedExpanded || closing

  useEffect(() => {
    if (!closing) return
    const el = slotElement
    let done = false
    const finish = () => {
      if (done) return
      done = true
      setClosing(false)
    }
    const onEnd = (event: TransitionEvent) => {
      if (event.target === el && event.propertyName === "width") finish()
    }
    el?.addEventListener("transitionend", onEnd)
    // Safety net if `transitionend` never fires (e.g. the width was already 0).
    const fallback = window.setTimeout(finish, 400)
    return () => {
      el?.removeEventListener("transitionend", onEnd)
      window.clearTimeout(fallback)
    }
  }, [closing, slotElement])

  return { dockedPresent }
}
