"use client"

import { useCallback } from "react"

const FOCUS_MODE_ATTRIBUTE = "data-focus-mode"
const KEYBOARD_FOCUS_MODE = "keyboard"

/**
 * Publishes the document's current input modality for shared focus variants.
 * The controller owns no React state: capture-phase input events update the
 * stable html attribute before the focused control's presentation is resolved.
 */
function FocusModeController() {
  const attachInputModality = useCallback((node: HTMLSpanElement | null) => {
    if (!node) return

    const ownerDocument = node.ownerDocument
    const root = ownerDocument.documentElement
    const markKeyboard = () => {
      root.setAttribute(FOCUS_MODE_ATTRIBUTE, KEYBOARD_FOCUS_MODE)
    }
    const markPointer = () => {
      root.removeAttribute(FOCUS_MODE_ATTRIBUTE)
    }

    ownerDocument.addEventListener("keydown", markKeyboard, true)
    ownerDocument.addEventListener("pointerdown", markPointer, true)

    return () => {
      ownerDocument.removeEventListener("keydown", markKeyboard, true)
      ownerDocument.removeEventListener("pointerdown", markPointer, true)
      root.removeAttribute(FOCUS_MODE_ATTRIBUTE)
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
