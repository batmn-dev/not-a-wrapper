"use client"

import { useCallback, type RefCallback } from "react"

type Prefetch = () => void | Promise<unknown>

/** Creates one retryable, promise-deduplicated module preloader. */
function createIntentPreloader<T>(load: () => Promise<T>) {
  let pending: Promise<T> | undefined

  return () => {
    if (pending) return pending
    const attempt = load()
    pending = attempt
    void attempt.catch(() => {
      if (pending === attempt) pending = undefined
    })
    return attempt
  }
}

/**
 * Warms a lazy interaction surface from keyboard focus, pointer hover, touch
 * start, and coarse-pointer visibility.
 * The callback ref owns every listener and observer for the target element.
 */
function useIntentPrefetch<ElementType extends HTMLElement>(
  prefetch: Prefetch | undefined
): RefCallback<ElementType> {
  return useCallback(
    (element) => {
      if (!element || !prefetch) return

      let attempted = false
      const warm = () => {
        if (attempted) return
        attempted = true
        try {
          const result = prefetch()
          if (result instanceof Promise) {
            void result.catch(() => {
              attempted = false
            })
          }
        } catch {
          attempted = false
        }
      }

      element.addEventListener("focus", warm, true)
      element.addEventListener("pointerover", warm)
      element.addEventListener("touchstart", warm, { passive: true })

      const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches
      const observer =
        coarsePointer && typeof IntersectionObserver !== "undefined"
          ? new IntersectionObserver((entries) => {
              if (entries.some((entry) => entry.isIntersecting)) warm()
            })
          : null
      observer?.observe(element)

      return () => {
        element.removeEventListener("focus", warm, true)
        element.removeEventListener("pointerover", warm)
        element.removeEventListener("touchstart", warm)
        observer?.disconnect()
      }
    },
    [prefetch]
  )
}

export { createIntentPreloader, useIntentPrefetch, type Prefetch }
