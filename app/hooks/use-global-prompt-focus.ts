import type { RefObject } from "react"
import { useEffect } from "react"

/** Routes unmodified printable keys to the composer without stealing form focus. */
export function useGlobalPromptFocus(focusRef: RefObject<(() => void) | null>) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (typeof e.key !== "string" || e.key.length !== 1) return

      const target = e.target as HTMLElement
      const tag = target.tagName?.toLowerCase()
      if (
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        target.isContentEditable
      ) {
        return
      }

      // Focus the textarea — the browser will route the pending character
      // input into the now-focused element automatically.
      focusRef.current?.()
    }

    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [focusRef])
}
