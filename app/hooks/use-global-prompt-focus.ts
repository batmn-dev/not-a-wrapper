import type { RefObject } from "react"
import { useEffect } from "react"

/**
 * Listens for printable-character keystrokes anywhere on the page and
 * auto-focuses the chat textarea so the character is typed into it.
 *
 * Skips when:
 * - A modifier key is held (Meta / Ctrl / Alt)
 * - The active element is already an input, textarea, select, or contentEditable
 * - The key is non-printable (arrows, Escape, function keys, etc.)
 */
export function useGlobalPromptFocus(focusRef: RefObject<(() => void) | null>) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Let existing shortcuts (Cmd+K, Cmd+Shift+P, etc.) pass through
      if (e.metaKey || e.ctrlKey || e.altKey) return

      // Only handle printable characters (single-char keys)
      if (typeof e.key !== "string" || e.key.length !== 1) return

      // Don't steal focus from inputs, textareas, selects, or contentEditable
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
