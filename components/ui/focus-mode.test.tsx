/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { FocusModeController } from "./focus-mode"

describe("FocusModeController", () => {
  let container: HTMLDivElement
  let root: Root

  beforeAll(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterAll(() => {
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT
  })

  beforeEach(() => {
    document.documentElement.removeAttribute("data-focus-mode")
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(<FocusModeController />))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.documentElement.removeAttribute("data-focus-mode")
  })

  function controls() {
    const first = document.createElement("button")
    const second = document.createElement("textarea")
    container.append(first, second)
    first.focus()
    return { first, second }
  }

  function keydown(key = "Tab") {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key })
    )
  }

  it("transfers keyboard modality across Tab, programmatic focus, and blur", () => {
    const { first, second } = controls()
    keydown()
    expect(first.dataset.focusMode).toBe("keyboard")
    second.focus() // Tab's native default action moves focus after keydown.
    expect(first.hasAttribute("data-focus-mode")).toBe(false)
    expect(second.dataset.focusMode).toBe("keyboard")

    second.blur()
    expect(second.hasAttribute("data-focus-mode")).toBe(false)
    first.focus() // Programmatic focus retains the last input modality.
    expect(first.dataset.focusMode).toBe("keyboard")
    expect(document.documentElement.hasAttribute("data-focus-mode")).toBe(false)
  })

  it("clears keyboard presentation on a prevented pointer press and subsequent focus", () => {
    const { first, second } = controls()
    keydown()
    second.addEventListener("pointerdown", (event) => event.preventDefault())
    second.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(first)
    expect(first.hasAttribute("data-focus-mode")).toBe(false)
    second.focus()
    expect(second.hasAttribute("data-focus-mode")).toBe(false)
    keydown("a")
    expect(second.dataset.focusMode).toBe("keyboard")
  })

  it("does not rewrite an unchanged marker or mutate the HTML element", () => {
    const { first } = controls()
    const setMarker = vi.spyOn(first, "setAttribute")
    const setRoot = vi.spyOn(document.documentElement, "setAttribute")
    const removeRoot = vi.spyOn(document.documentElement, "removeAttribute")
    try {
      keydown("a")
      keydown("b")
      keydown("c")
      document.dispatchEvent(new Event("pointerdown", { bubbles: true }))
      expect(setMarker).toHaveBeenCalledExactlyOnceWith("data-focus-mode", "keyboard")
      expect(setRoot).not.toHaveBeenCalled()
      expect(removeRoot).not.toHaveBeenCalled()
    } finally {
      setMarker.mockRestore()
      setRoot.mockRestore()
      removeRoot.mockRestore()
    }
  })

  it("cleans detached targets at the next focus event and removes its listeners on unmount", () => {
    const { first, second } = controls()
    keydown()
    first.remove() // Browsers can remove a focused node without firing focusout.
    second.focus()
    expect(first.hasAttribute("data-focus-mode")).toBe(false)
    expect(second.dataset.focusMode).toBe("keyboard")
    second.remove()
    act(() => root.unmount())
    expect(second.hasAttribute("data-focus-mode")).toBe(false)
    root = createRoot(container)

    container.append(first)
    first.focus()
    keydown()
    expect(first.hasAttribute("data-focus-mode")).toBe(false)
    expect(document.documentElement.hasAttribute("data-focus-mode")).toBe(false)
  })
})
