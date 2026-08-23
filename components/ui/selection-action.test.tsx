/** @vitest-environment jsdom */
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getSelectionAnchorGeometry, SelectionAction } from "./selection-action"

class ResizeObserverMock {
  static instances: ResizeObserverMock[] = []
  readonly callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    ResizeObserverMock.instances.push(this)
  }

  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("SelectionAction", () => {
  let container: HTMLDivElement
  let message: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    ResizeObserverMock.instances = []
    vi.stubGlobal("ResizeObserver", ResizeObserverMock)
    container = document.createElement("div")
    message = document.createElement("div")
    document.body.append(container, message)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    message.remove()
    vi.unstubAllGlobals()
  })

  it("uses logical inline geometry for both writing directions", () => {
    const selection = {
      left: 140,
      right: 340,
      top: 180,
      bottom: 220,
      width: 200,
      height: 40,
    }
    const messageRect = { left: 100, right: 500, top: 120 }

    expect(getSelectionAnchorGeometry(selection, messageRect, "ltr")).toEqual({
      blockSize: 40,
      blockStart: 60,
      inlineSize: 200,
      inlineStart: 40,
    })
    expect(getSelectionAnchorGeometry(selection, messageRect, "rtl")).toEqual({
      blockSize: 40,
      blockStart: 60,
      inlineSize: 200,
      inlineStart: 160,
    })
  })

  it("rewrites the synthetic anchor when the selected message resizes", () => {
    let selectionTop = 180
    vi.spyOn(message, "getBoundingClientRect").mockReturnValue({
      left: 100,
      right: 500,
      top: 120,
    } as DOMRect)
    const range = {
      getBoundingClientRect: () =>
        ({
          left: 140,
          right: 340,
          top: selectionTop,
          bottom: selectionTop + 40,
          width: 200,
          height: 40,
        }) as DOMRect,
    } as Range

    act(() => {
      root.render(
        <SelectionAction container={message} range={range}>
          <button>Quote</button>
        </SelectionAction>
      )
    })

    const layer = container.querySelector<HTMLElement>(
      '[data-slot="selection-action"]'
    )
    expect(
      layer?.style.getPropertyValue("--targeted-action-anchor-block-start")
    ).toBe("60px")

    selectionTop = 220
    act(() =>
      ResizeObserverMock.instances[0]?.callback([], {} as ResizeObserver)
    )

    expect(
      layer?.style.getPropertyValue("--targeted-action-anchor-block-start")
    ).toBe("100px")
  })
})
