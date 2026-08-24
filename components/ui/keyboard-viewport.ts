const MIN_VIRTUAL_KEYBOARD_HEIGHT = 80

// Deterministic fixtures use the same root-owned token/cascade as runtime
// viewport measurement instead of introducing a descendant override system.
const SCREEN_KEYBOARD_HEIGHT_OVERRIDE_ATTRIBUTE =
  "data-screen-keyboard-height-override"

type VirtualKeyboardApi = EventTarget & {
  boundingRect: DOMRectReadOnly
  overlaysContent: boolean
}

function isVirtualKeyboardTarget(element: Element | null) {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLElement && element.isContentEditable)
  )
}

function getVirtualKeyboardApi() {
  return (navigator as Navigator & { virtualKeyboard?: VirtualKeyboardApi })
    .virtualKeyboard
}

function readRootKeyboardOverride(root: HTMLElement) {
  if (!root.hasAttribute(SCREEN_KEYBOARD_HEIGHT_OVERRIDE_ATTRIBUTE)) return null
  const value = Number.parseFloat(
    root.style.getPropertyValue("--screen-keyboard-height")
  )
  return Number.isFinite(value) ? value : 0
}

/**
 * Owns ChatGPT's document-level mobile-keyboard contract. Supporting browsers
 * use the Virtual Keyboard API's real bounding rectangle in overlay mode;
 * visualViewport remains a bounded fallback for browsers without that API.
 *
 * The returned cleanup is the complete Interface. It restores browser overlay
 * ownership and removes only the document state this controller published.
 */
function createKeyboardViewportController(root: HTMLElement) {
  const keyboard = getVirtualKeyboardApi()
  const viewport = window.visualViewport
  const documentElement = document.documentElement
  const body = document.body
  const hadKeyboardClass = documentElement.classList.contains("keyboard-open")
  let frame: number | null = null
  let ownsBodyHeight = false

  const writeHeight = (height: number) => {
    const override = readRootKeyboardOverride(root)
    const resolvedHeight = override ?? Math.max(0, height)
    const isOpen = resolvedHeight > 0

    if (override === null) {
      const roundedHeight = Math.round(resolvedHeight * 100) / 100
      body.style.setProperty("--screen-keyboard-height", `${roundedHeight}px`)
      ownsBodyHeight = true
    }

    root.toggleAttribute("data-keyboard-open", isOpen)
    documentElement.classList.toggle(
      "keyboard-open",
      hadKeyboardClass || isOpen
    )
  }

  const clearHeight = () => {
    if (ownsBodyHeight) {
      body.style.removeProperty("--screen-keyboard-height")
      ownsBodyHeight = false
    }
    root.removeAttribute("data-keyboard-open")
    documentElement.classList.toggle("keyboard-open", hadKeyboardClass)
  }

  if (keyboard) {
    const previousOverlaysContent = keyboard.overlaysContent
    let keyboardTargetFocused = false

    const writeGeometry = () => writeHeight(keyboard.boundingRect.height)
    const handleFocusIn = (event: FocusEvent) => {
      if (!isVirtualKeyboardTarget(event.target as Element | null)) return
      keyboardTargetFocused = true
      if (frame !== null) {
        cancelAnimationFrame(frame)
        frame = null
      }
      keyboard.addEventListener("geometrychange", writeGeometry)
    }
    const handleFocusOut = () => {
      keyboardTargetFocused = false
      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = null
        if (keyboardTargetFocused) return
        keyboard.removeEventListener("geometrychange", writeGeometry)
        clearHeight()
      })
    }

    keyboard.overlaysContent = true
    document.addEventListener("focusin", handleFocusIn)
    document.addEventListener("focusout", handleFocusOut)

    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      keyboard.overlaysContent = previousOverlaysContent
      keyboard.removeEventListener("geometrychange", writeGeometry)
      document.removeEventListener("focusin", handleFocusIn)
      document.removeEventListener("focusout", handleFocusOut)
      clearHeight()
    }
  }

  if (!viewport) return clearHeight

  const writeViewportGeometry = () => {
    frame = null
    const hasKeyboardTarget = isVirtualKeyboardTarget(document.activeElement)
    const layoutViewportHeight = Math.max(
      window.innerHeight,
      documentElement.clientHeight,
      root.getBoundingClientRect().height,
      viewport.height + viewport.offsetTop
    )
    const obscuredHeight =
      hasKeyboardTarget && viewport.scale === 1
        ? Math.max(
            0,
            layoutViewportHeight - viewport.height - viewport.offsetTop
          )
        : 0
    writeHeight(
      obscuredHeight >= MIN_VIRTUAL_KEYBOARD_HEIGHT ? obscuredHeight : 0
    )
  }
  const scheduleViewportWrite = () => {
    if (frame !== null) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(writeViewportGeometry)
  }

  writeViewportGeometry()
  viewport.addEventListener("resize", scheduleViewportWrite)
  viewport.addEventListener("scroll", scheduleViewportWrite)
  window.addEventListener("resize", scheduleViewportWrite)
  window.addEventListener("orientationchange", scheduleViewportWrite)
  document.addEventListener("focusin", scheduleViewportWrite)
  document.addEventListener("focusout", scheduleViewportWrite)

  return () => {
    if (frame !== null) cancelAnimationFrame(frame)
    viewport.removeEventListener("resize", scheduleViewportWrite)
    viewport.removeEventListener("scroll", scheduleViewportWrite)
    window.removeEventListener("resize", scheduleViewportWrite)
    window.removeEventListener("orientationchange", scheduleViewportWrite)
    document.removeEventListener("focusin", scheduleViewportWrite)
    document.removeEventListener("focusout", scheduleViewportWrite)
    clearHeight()
  }
}

export { createKeyboardViewportController }
