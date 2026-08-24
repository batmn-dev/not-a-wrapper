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
 * ChatGPT's keyboard signal contract: `keyboard-opened` dispatches when a
 * keyboard-summoning element gains focus, `keyboard-closed` after the
 * keyboard geometry actually collapses (or a 500ms fallback). Consumers use
 * `closeVirtualKeyboard` to sequence UI (open a sheet only after the
 * keyboard has left the viewport).
 */
const KEYBOARD_OPENED_EVENT = "keyboard-opened"
const KEYBOARD_CLOSED_EVENT = "keyboard-closed"
const KEYBOARD_CLOSE_FALLBACK_MS = 500
const KEYBOARD_CLOSE_SETTLE_MS = 100

let keyboardEventTarget: EventTarget | null = null
let isKeyboardOpen = false
let focusedKeyboardElement: HTMLElement | null = null

function getKeyboardEventTarget() {
  keyboardEventTarget ??= new EventTarget()
  return keyboardEventTarget
}

function dispatchKeyboardEvent(name: string) {
  getKeyboardEventTarget().dispatchEvent(new CustomEvent(name))
}

function isVirtualKeyboardOpen() {
  return isKeyboardOpen
}

/**
 * ChatGPT's closeKeyboard: blur the focused keyboard target, then invoke the
 * callback once the keyboard has actually closed — via the `keyboard-closed`
 * signal or a 500ms fallback, whichever lands first. When no keyboard target
 * is focused the callback runs immediately.
 */
function closeVirtualKeyboard(onClosed?: () => void) {
  const active = document.activeElement
  const target =
    focusedKeyboardElement ??
    (isVirtualKeyboardTarget(active) ? (active as HTMLElement) : null)
  if (!target || !isKeyboardOpen) {
    onClosed?.()
    return
  }

  const controller = new AbortController()
  target.blur()
  getKeyboardEventTarget().addEventListener(
    KEYBOARD_CLOSED_EVENT,
    () => {
      controller.abort()
      onClosed?.()
    },
    { signal: controller.signal }
  )
  const fallback = window.setTimeout(() => {
    onClosed?.()
    controller.abort()
  }, KEYBOARD_CLOSE_FALLBACK_MS)
  controller.signal.addEventListener("abort", () => {
    window.clearTimeout(fallback)
  })
}

/**
 * Owns ChatGPT's document-level mobile-keyboard contract (their controller is
 * VirtualKeyboard-API-only; the visualViewport branch below is our extension
 * for browsers without that API, notably iOS Safari, where ChatGPT accepts
 * the browser-default keyboard behavior).
 *
 * VirtualKeyboard branch semantics, ported from their code: overlay mode on,
 * `focusin` on a keyboard target arms `geometrychange`, which writes the RAW
 * `boundingRect.height` to `--screen-keyboard-height` and adds the
 * `keyboard-open` class — the class stays on until focus leaves the target,
 * even if the keyboard geometry collapses to zero mid-focus. `focusout`
 * tears down on the next frame, then watches for the geometry to reach zero
 * (settled +100ms) before dispatching `keyboard-closed`, with a 500ms
 * fallback.
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
      body.style.setProperty("--screen-keyboard-height", `${resolvedHeight}px`)
      ownsBodyHeight = true
    }

    root.toggleAttribute("data-keyboard-open", isOpen)
    documentElement.classList.toggle(
      "keyboard-open",
      hadKeyboardClass || isOpen
    )
    if (isOpen !== isKeyboardOpen) {
      isKeyboardOpen = isOpen
      dispatchKeyboardEvent(
        isOpen ? KEYBOARD_OPENED_EVENT : KEYBOARD_CLOSED_EVENT
      )
    }
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

    const applyGeometry = () => {
      const override = readRootKeyboardOverride(root)
      const height = override ?? keyboard.boundingRect.height
      body.style.setProperty("--screen-keyboard-height", `${height}px`)
      ownsBodyHeight = true
      // ChatGPT parity: any geometry while focused keeps keyboard-open on —
      // it only comes off in the focus-out teardown.
      root.toggleAttribute("data-keyboard-open", true)
      documentElement.classList.add("keyboard-open")
    }
    const dispatchClosedWhenSettled = () => {
      let fallback: number
      const handleGeometry = () => {
        if (keyboard.boundingRect.height !== 0) return
        window.setTimeout(() => {
          keyboard.removeEventListener("geometrychange", handleGeometry)
          dispatchKeyboardEvent(KEYBOARD_CLOSED_EVENT)
          window.clearTimeout(fallback)
        }, KEYBOARD_CLOSE_SETTLE_MS)
      }
      fallback = window.setTimeout(() => {
        keyboard.removeEventListener("geometrychange", handleGeometry)
        dispatchKeyboardEvent(KEYBOARD_CLOSED_EVENT)
      }, KEYBOARD_CLOSE_FALLBACK_MS)
      keyboard.addEventListener("geometrychange", handleGeometry)
    }
    const teardownWhenUnfocused = () => {
      frame = null
      if (keyboardTargetFocused) return
      focusedKeyboardElement = null
      keyboard.removeEventListener("geometrychange", applyGeometry)
      clearHeight()
      dispatchClosedWhenSettled()
    }
    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as Element | null
      if (!isVirtualKeyboardTarget(target)) return
      keyboardTargetFocused = true
      focusedKeyboardElement = target as HTMLElement
      if (!isKeyboardOpen) {
        isKeyboardOpen = true
        dispatchKeyboardEvent(KEYBOARD_OPENED_EVENT)
      }
      if (frame !== null) {
        cancelAnimationFrame(frame)
        frame = null
      }
      keyboard.addEventListener("geometrychange", applyGeometry)
    }
    const handleFocusOut = () => {
      keyboardTargetFocused = false
      isKeyboardOpen = false
      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(teardownWhenUnfocused)
    }

    keyboard.overlaysContent = true
    document.addEventListener("focusin", handleFocusIn)
    document.addEventListener("focusout", handleFocusOut)

    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      keyboard.overlaysContent = previousOverlaysContent
      keyboard.removeEventListener("geometrychange", applyGeometry)
      document.removeEventListener("focusin", handleFocusIn)
      document.removeEventListener("focusout", handleFocusOut)
      isKeyboardOpen = false
      focusedKeyboardElement = null
      clearHeight()
    }
  }

  if (!viewport) return clearHeight

  const writeViewportGeometry = () => {
    frame = null
    const active = document.activeElement
    const hasKeyboardTarget = isVirtualKeyboardTarget(active)
    focusedKeyboardElement = hasKeyboardTarget ? (active as HTMLElement) : null
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
    isKeyboardOpen = false
    focusedKeyboardElement = null
    clearHeight()
  }
}

export {
  closeVirtualKeyboard,
  createKeyboardViewportController,
  isVirtualKeyboardOpen,
}
