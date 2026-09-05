"use client"

import { useCallback } from "react"

const FOCUS_MODE_ATTRIBUTE = "data-focus-mode"
const KEYBOARD_FOCUS_MODE = "keyboard"

/**
 * Publishes input modality only on the focused element, avoiding document-wide
 * style invalidation. Native :focus-visible still decides whether to show a ring.
 */
function FocusModeController() {
  const attachInputModality = useCallback((node: HTMLSpanElement | null) => {
    if (!node) return

    const ownerDocument = node.ownerDocument
    let keyboardMode = false
    let markedElement: Element | null = null
    const clearMarker = () => {
      markedElement?.removeAttribute(FOCUS_MODE_ATTRIBUTE)
      markedElement = null
    }
    const updateMarker = () => {
      const focusedElement = ownerDocument.activeElement
      const next = keyboardMode && focusedElement !== ownerDocument.documentElement
        ? focusedElement
        : null
      if (next === markedElement) return
      clearMarker()
      markedElement = next
      markedElement?.setAttribute(FOCUS_MODE_ATTRIBUTE, KEYBOARD_FOCUS_MODE)
    }
    const markKeyboard = () => {
      keyboardMode = true
      updateMarker()
    }
    const markPointer = () => {
      keyboardMode = false
      clearMarker()
    }

    ownerDocument.addEventListener("keydown", markKeyboard, true)
    ownerDocument.addEventListener("pointerdown", markPointer, true)
    ownerDocument.addEventListener("focusin", updateMarker, true)
    ownerDocument.addEventListener("focusout", clearMarker, true)

    return () => {
      ownerDocument.removeEventListener("keydown", markKeyboard, true)
      ownerDocument.removeEventListener("pointerdown", markPointer, true)
      ownerDocument.removeEventListener("focusin", updateMarker, true)
      ownerDocument.removeEventListener("focusout", clearMarker, true)
      clearMarker()
    }
  }, [])

  return (
    <span
      ref={attachInputModality}
      aria-hidden="true"
      data-focus-mode-controller=""
      hidden
    />
  )
}

export { FocusModeController }
