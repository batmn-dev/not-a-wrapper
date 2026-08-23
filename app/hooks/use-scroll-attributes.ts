"use client"

import { useCallback, useRef } from "react"

const SCROLL_STATE_TOP_SHADOW = "--scroll-state-top-shadow"
const SCROLL_STATE_BOTTOM_SHADOW = "--scroll-state-bottom-shadow"
const SCROLL_STATE_TOP_OPACITY = "--scroll-state-top-opacity"
const SCROLL_STATE_BOTTOM_OPACITY = "--scroll-state-bottom-opacity"

export function supportsScrollStateQueries() {
  return (
    typeof CSS !== "undefined" && CSS.supports("container-type: scroll-state")
  )
}

function clearFallbackPresentation(element: HTMLElement) {
  delete element.dataset.scrolledFromTop
  delete element.dataset.scrolledFromEnd
  element.style.removeProperty(SCROLL_STATE_TOP_SHADOW)
  element.style.removeProperty(SCROLL_STATE_BOTTOM_SHADOW)
  element.style.removeProperty(SCROLL_STATE_TOP_OPACITY)
  element.style.removeProperty(SCROLL_STATE_BOTTOM_OPACITY)
}

/**
 * Compatibility path for browsers without CSS scroll-state queries. Modern
 * browsers derive boundary presentation in CSS and never install this listener.
 */
export function connectScrollAttributeFallback(
  element: HTMLElement,
  { threshold = 5 }: { threshold?: number } = {}
) {
  clearFallbackPresentation(element)
  if (supportsScrollStateQueries()) return () => undefined

  const update = () => {
    const { scrollTop, scrollHeight, clientHeight } = element
    const scrolledFromTop = scrollTop > threshold
    const scrolledFromEnd = scrollTop + clientHeight < scrollHeight - threshold

    element.toggleAttribute("data-scrolled-from-top", scrolledFromTop)
    element.toggleAttribute("data-scrolled-from-end", scrolledFromEnd)
    element.style.setProperty(
      SCROLL_STATE_TOP_SHADOW,
      scrolledFromTop
        ? "var(--sharp-edge-top-shadow)"
        : "var(--sharp-edge-top-shadow-placeholder)"
    )
    element.style.setProperty(
      SCROLL_STATE_BOTTOM_SHADOW,
      scrolledFromEnd
        ? "var(--sharp-edge-bottom-shadow)"
        : "var(--sharp-edge-bottom-shadow-placeholder)"
    )
    element.style.setProperty(
      SCROLL_STATE_TOP_OPACITY,
      scrolledFromTop ? "1" : "0"
    )
    element.style.setProperty(
      SCROLL_STATE_BOTTOM_OPACITY,
      scrolledFromEnd ? "1" : "0"
    )
  }

  update()
  element.addEventListener("scroll", update, { passive: true })
  const resizeObserver =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update)
  resizeObserver?.observe(element)

  return () => {
    element.removeEventListener("scroll", update)
    resizeObserver?.disconnect()
    clearFallbackPresentation(element)
  }
}

/**
 * CSS-first scroll boundary tracking with a zero-rerender compatibility path.
 *
 * The returned callback ref makes the target a CSS scroll-state container.
 * Browsers without that primitive receive the legacy data attributes and
 * equivalent inherited presentation variables.
 *
 * @example
 * ```tsx
 * const scrollRef = useRef<HTMLElement>(null)
 * const scrollStateRef = useScrollAttributes(scrollRef)
 *
 * <nav ref={scrollStateRef} className="scroll-state-scrollport overflow-y-auto">
 *   <div className="scroll-state-shadow-top">
 *     Header with scroll shadow
 *   </div>
 * </nav>
 * ```
 */
export function useScrollAttributes(
  ref: React.RefObject<HTMLElement | null>,
  { threshold = 5 }: { threshold?: number } = {}
) {
  const cleanupRef = useRef<(() => void) | null>(null)

  return useCallback(
    (element: HTMLElement | null) => {
      cleanupRef.current?.()
      cleanupRef.current = null
      ref.current = element
      if (!element) return

      const cleanup = connectScrollAttributeFallback(element, { threshold })
      cleanupRef.current = cleanup
      return () => {
        cleanup()
        cleanupRef.current = null
        if (ref.current === element) ref.current = null
      }
    },
    [ref, threshold]
  )
}
