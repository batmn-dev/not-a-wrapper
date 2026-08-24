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

type VirtualKeyboardSignal =
  typeof KEYBOARD_OPENED_EVENT | typeof KEYBOARD_CLOSED_EVENT

/**
 * The document-wide keyboard store (ChatGPT's controller keeps this state in
 * a store with an event bus). Open-state writes and signal dispatches are
 * deliberately decoupled: the controller keeps `isOpen` current per
 * focus/geometry transition, while `keyboard-closed` fires only once the
 * geometry has actually settled (or the fallback lands).
 */
const virtualKeyboardStore = {
  isOpen: false,
  focusedElement: null as HTMLElement | null,
  events: new EventTarget(),
  emit(signal: VirtualKeyboardSignal) {
    this.events.dispatchEvent(new CustomEvent(signal))
  },
}

function isVirtualKeyboardOpen() {
  return virtualKeyboardStore.isOpen
}

/**
 * Notifies on every keyboard-opened / keyboard-closed signal and returns an
 * unsubscribe. Pairs with `isVirtualKeyboardOpen` as a useSyncExternalStore
 * seam for React consumers (keyboard-aware sheets, drawers).
 */
function subscribeVirtualKeyboard(listener: () => void) {
  const { events } = virtualKeyboardStore
  events.addEventListener(KEYBOARD_OPENED_EVENT, listener)
  events.addEventListener(KEYBOARD_CLOSED_EVENT, listener)
  return () => {
    events.removeEventListener(KEYBOARD_OPENED_EVENT, listener)
    events.removeEventListener(KEYBOARD_CLOSED_EVENT, listener)
  }
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
    virtualKeyboardStore.focusedElement ??
    (isVirtualKeyboardTarget(active) ? (active as HTMLElement) : null)
  if (!target || !virtualKeyboardStore.isOpen) {
    onClosed?.()
    return
  }

  const controller = new AbortController()
  target.blur()
  virtualKeyboardStore.events.addEventListener(
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
    let closeWatcher: AbortController | null = null

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
      closeWatcher?.abort()
      const watcher = new AbortController()
      closeWatcher = watcher
      let settle: number | null = null

      const dispatchClosed = () => {
        if (watcher.signal.aborted) return
        watcher.abort()
        virtualKeyboardStore.emit(KEYBOARD_CLOSED_EVENT)
      }
      const handleGeometry = () => {
        if (settle !== null || keyboard.boundingRect.height !== 0) return
        settle = window.setTimeout(dispatchClosed, KEYBOARD_CLOSE_SETTLE_MS)
      }
      const fallback = window.setTimeout(
        dispatchClosed,
        KEYBOARD_CLOSE_FALLBACK_MS
      )
      watcher.signal.addEventListener("abort", () => {
        if (settle !== null) window.clearTimeout(settle)
        window.clearTimeout(fallback)
        keyboard.removeEventListener("geometrychange", handleGeometry)
        if (closeWatcher === watcher) closeWatcher = null
      })
      keyboard.addEventListener("geometrychange", handleGeometry)
    }
    const teardownWhenUnfocused = () => {
      frame = null
      if (keyboardTargetFocused) return
      virtualKeyboardStore.focusedElement = null
      keyboard.removeEventListener("geometrychange", applyGeometry)
      clearHeight()
      dispatchClosedWhenSettled()
    }
    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as Element | null
      if (!isVirtualKeyboardTarget(target)) return
      closeWatcher?.abort()
      keyboardTargetFocused = true
      virtualKeyboardStore.focusedElement = target as HTMLElement
      if (!virtualKeyboardStore.isOpen) {
        virtualKeyboardStore.isOpen = true
        virtualKeyboardStore.emit(KEYBOARD_OPENED_EVENT)
      }
      if (frame !== null) {
        cancelAnimationFrame(frame)
        frame = null
      }
      keyboard.addEventListener("geometrychange", applyGeometry)
    }
    const handleFocusOut = () => {
      keyboardTargetFocused = false
      virtualKeyboardStore.isOpen = false
      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(teardownWhenUnfocused)
    }

    keyboard.overlaysContent = true
    document.addEventListener("focusin", handleFocusIn)
    document.addEventListener("focusout", handleFocusOut)

    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      closeWatcher?.abort()
      keyboard.overlaysContent = previousOverlaysContent
      keyboard.removeEventListener("geometrychange", applyGeometry)
      document.removeEventListener("focusin", handleFocusIn)
      document.removeEventListener("focusout", handleFocusOut)
      virtualKeyboardStore.isOpen = false
      virtualKeyboardStore.focusedElement = null
      clearHeight()
    }
  }

  if (!viewport) return clearHeight

  // ChatGPT does not initialize its keyboard signal store without the
  // Virtual Keyboard API. This fallback publishes layout geometry only, so
  // unsupported browsers keep their native focus and menu-opening behavior.
  const writeViewportGeometry = () => {
    frame = null
    const active = document.activeElement
    const hasKeyboardTarget = isVirtualKeyboardTarget(active)
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

export {
  closeVirtualKeyboard,
  createKeyboardViewportController,
  isVirtualKeyboardOpen,
  subscribeVirtualKeyboard,
}
