/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  closeVirtualKeyboard,
  createKeyboardViewportController,
  isVirtualKeyboardOpen,
  subscribeVirtualKeyboard,
} from "./keyboard-viewport"

class FakeVirtualKeyboard extends EventTarget {
  boundingRect = { height: 0 } as DOMRectReadOnly
  overlaysContent = false

  setHeight(height: number) {
    this.boundingRect = { height } as DOMRectReadOnly
    this.dispatchEvent(new Event("geometrychange"))
  }
}

class FakeVisualViewport extends EventTarget {
  height = 500
  offsetTop = 0
  scale = 1
}

describe("keyboard viewport controller (VirtualKeyboard branch)", () => {
  let keyboard: FakeVirtualKeyboard
  let root: HTMLDivElement
  let input: HTMLInputElement
  let cleanup: (() => void) | undefined

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "requestAnimationFrame",
        "cancelAnimationFrame",
      ],
    })
    keyboard = new FakeVirtualKeyboard()
    Object.defineProperty(navigator, "virtualKeyboard", {
      configurable: true,
      value: keyboard,
    })
    root = document.createElement("div")
    input = document.createElement("input")
    document.body.append(root, input)
    cleanup = createKeyboardViewportController(root)
  })

  afterEach(() => {
    cleanup?.()
    root.remove()
    input.remove()
    delete (navigator as { virtualKeyboard?: unknown }).virtualKeyboard
    vi.useRealTimers()
  })

  it("owns overlay mode, writes raw geometry, and keeps keyboard-open until blur", () => {
    expect(keyboard.overlaysContent).toBe(true)

    input.focus()
    expect(isVirtualKeyboardOpen()).toBe(true)
    keyboard.setHeight(291.5)
    expect(
      document.body.style.getPropertyValue("--screen-keyboard-height")
    ).toBe("291.5px")
    expect(document.documentElement.classList.contains("keyboard-open")).toBe(
      true
    )
    expect(root.hasAttribute("data-keyboard-open")).toBe(true)

    // Geometry collapsing to zero mid-focus does not remove
    // the keyboard-open state — only losing focus does.
    keyboard.setHeight(0)
    expect(document.documentElement.classList.contains("keyboard-open")).toBe(
      true
    )
    expect(
      document.body.style.getPropertyValue("--screen-keyboard-height")
    ).toBe("0px")
  })

  it("dispatches keyboard-closed after blur once geometry settles at zero", () => {
    input.focus()
    keyboard.setHeight(300)

    const closed = vi.fn()
    closeVirtualKeyboard(closed)
    expect(document.activeElement).not.toBe(input)
    expect(closed).not.toHaveBeenCalled()

    vi.advanceTimersByTime(20) // requestAnimationFrame teardown
    expect(document.documentElement.classList.contains("keyboard-open")).toBe(
      false
    )
    keyboard.setHeight(0)
    vi.advanceTimersByTime(100) // settle delay
    expect(closed).toHaveBeenCalledTimes(1)
    // the 500ms fallback must not double-fire the callback
    vi.advanceTimersByTime(1000)
    expect(closed).toHaveBeenCalledTimes(1)
  })

  it("falls back to the 500ms timeout when no zero geometry ever arrives", () => {
    input.focus()
    keyboard.setHeight(300)

    const closed = vi.fn()
    closeVirtualKeyboard(closed)
    vi.advanceTimersByTime(20)
    vi.advanceTimersByTime(500)
    expect(closed).toHaveBeenCalledTimes(1)
  })

  it("cancels a pending close signal when a keyboard target regains focus", () => {
    const listener = vi.fn()
    const unsubscribe = subscribeVirtualKeyboard(listener)

    input.focus()
    keyboard.setHeight(300)
    input.blur()
    vi.advanceTimersByTime(20) // requestAnimationFrame teardown

    input.focus()
    expect(isVirtualKeyboardOpen()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(2) // opened, then reopened

    vi.advanceTimersByTime(1000)
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it("cancels a pending close signal when the controller unmounts", () => {
    const listener = vi.fn()
    const unsubscribe = subscribeVirtualKeyboard(listener)

    input.focus()
    keyboard.setHeight(300)
    input.blur()
    vi.advanceTimersByTime(20) // requestAnimationFrame teardown

    cleanup?.()
    cleanup = undefined
    vi.advanceTimersByTime(1000)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it("runs the callback immediately when no keyboard is open", () => {
    const closed = vi.fn()
    closeVirtualKeyboard(closed)
    expect(closed).toHaveBeenCalledTimes(1)
  })

  it("notifies subscribers on open and close signals until unsubscribed", () => {
    const listener = vi.fn()
    const unsubscribe = subscribeVirtualKeyboard(listener)

    input.focus()
    expect(isVirtualKeyboardOpen()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)

    closeVirtualKeyboard()
    vi.advanceTimersByTime(20) // requestAnimationFrame teardown
    keyboard.setHeight(0)
    vi.advanceTimersByTime(100) // settle delay
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    input.focus()
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe("keyboard viewport controller (visualViewport fallback)", () => {
  let cleanup: (() => void) | undefined
  let input: HTMLInputElement
  let originalVisualViewport: PropertyDescriptor | undefined
  let root: HTMLDivElement

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["requestAnimationFrame", "cancelAnimationFrame"],
    })
    delete (navigator as { virtualKeyboard?: unknown }).virtualKeyboard
    originalVisualViewport = Object.getOwnPropertyDescriptor(
      window,
      "visualViewport"
    )
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: new FakeVisualViewport(),
    })
    root = document.createElement("div")
    input = document.createElement("input")
    document.body.append(root, input)
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
      height: 800,
    } as DOMRect)
    cleanup = createKeyboardViewportController(root)
  })

  afterEach(() => {
    cleanup?.()
    root.remove()
    input.remove()
    if (originalVisualViewport) {
      Object.defineProperty(window, "visualViewport", originalVisualViewport)
    } else {
      delete (window as { visualViewport?: unknown }).visualViewport
    }
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it("keeps fallback geometry out of keyboard signals", () => {
    const listener = vi.fn()
    const unsubscribe = subscribeVirtualKeyboard(listener)

    input.focus()
    vi.advanceTimersByTime(20)

    expect(root.hasAttribute("data-keyboard-open")).toBe(true)
    expect(
      document.body.style.getPropertyValue("--screen-keyboard-height")
    ).toBe("300px")
    expect(isVirtualKeyboardOpen()).toBe(false)
    expect(listener).not.toHaveBeenCalled()

    input.blur()
    vi.advanceTimersByTime(20)
    expect(root.hasAttribute("data-keyboard-open")).toBe(false)
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })
})
