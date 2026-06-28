"use client"

import { useState } from "react"

/**
 * usePrefersReducedMotion — a lazy, render-stable snapshot of the user's
 * reduced-motion preference, read once at mount (the close-collapse gate does
 * not need live updates). SSR-safe: returns `false` on the server.
 */
export function usePrefersReducedMotion(): boolean {
  const [reducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  )
  return reducedMotion
}
