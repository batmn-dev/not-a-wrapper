/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest"
import { createKeyboardViewportController } from "./keyboard-viewport"

class VirtualKeyboardStub extends EventTarget {
  overlaysContent = false
  boundingRect = { height: 0 } as DOMRectReadOnly

  setHeight(height: number) {
    this.boundingRect = { height } as DOMRectReadOnly
    this.dispatchEvent(new Event("geometrychange"))
  }
}

describe("createKeyboardViewportController", () => {
  afterEach(() => {
    document.body.replaceChildren()
    document.documentElement.classList.remove("keyboard-open")
    document.body.style.removeProperty("--screen-keyboard-height")
    Reflect.deleteProperty(navigator, "virtualKeyboard")
    vi.restoreAllMocks()
  })

  it("adapts Virtual Keyboard geometry and restores browser ownership", () => {
    const keyboard = new VirtualKeyboardStub()
    Object.defineProperty(navigator, "virtualKeyboard", {
      configurable: true,
      value: keyboard,
    })
    const root = document.createElement("div")
    const editor = document.createElement("textarea")
    root.appendChild(editor)
    document.body.appendChild(root)

    const cleanup = createKeyboardViewportController(root)
    editor.focus()
    keyboard.setHeight(284)

    expect(keyboard.overlaysContent).toBe(true)
    expect(root.hasAttribute("data-keyboard-open")).toBe(true)
    expect(document.documentElement.classList).toContain("keyboard-open")
    expect(
      document.body.style.getPropertyValue("--screen-keyboard-height")
    ).toBe("284px")

    cleanup()

    expect(keyboard.overlaysContent).toBe(false)
    expect(root.hasAttribute("data-keyboard-open")).toBe(false)
    expect(document.documentElement.classList).not.toContain("keyboard-open")
    expect(
      document.body.style.getPropertyValue("--screen-keyboard-height")
    ).toBe("")
  })
})
