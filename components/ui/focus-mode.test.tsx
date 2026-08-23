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

  it("publishes keyboard modality and clears it before pointer focus", () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Tab" })
    )
    expect(document.documentElement.dataset.focusMode).toBe("keyboard")

    document.dispatchEvent(new Event("pointerdown", { bubbles: true }))
    expect(document.documentElement.hasAttribute("data-focus-mode")).toBe(false)
  })

  it("removes its document listeners with the callback-ref lifecycle", () => {
    act(() => root.unmount())
    root = createRoot(container)

    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Tab" })
    )
    expect(document.documentElement.hasAttribute("data-focus-mode")).toBe(false)
  })
})
