/** @vitest-environment jsdom */
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { QuoteButton } from "./quote-button"

describe("QuoteButton", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("positions Add to chat above the selected text", () => {
    const messageContainer = document.createElement("div")
    document.body.appendChild(messageContainer)
    vi.spyOn(messageContainer, "getBoundingClientRect").mockReturnValue({
      left: 20,
      top: 40,
      width: 600,
      height: 400,
      right: 620,
      bottom: 440,
      x: 20,
      y: 40,
      toJSON: () => ({}),
    })
    const range = {
      getBoundingClientRect: () => ({
        left: 120,
        top: 160,
        width: 240,
        height: 48,
        right: 360,
        bottom: 208,
      }),
    } as Range

    act(() => {
      root.render(
        <QuoteButton
          container={messageContainer}
          onQuote={() => undefined}
          range={range}
        />
      )
    })

    const button = container.querySelector("button")
    const layer = container.querySelector<HTMLElement>(
      '[data-slot="selection-action"]'
    )
    const anchor = container.querySelector(
      '[data-slot="selection-action-anchor"]'
    )
    const positioner = container.querySelector(
      '[data-slot="selection-action-positioner"]'
    )

    expect(button?.textContent).toBe("Add to chat")
    expect(anchor).not.toBeNull()
    expect(positioner?.contains(button ?? null)).toBe(true)
    expect(
      layer?.style.getPropertyValue("--targeted-action-anchor-inline-start")
    ).toBe("100px")
    expect(
      layer?.style.getPropertyValue("--targeted-action-anchor-block-start")
    ).toBe("120px")
    expect(
      layer?.style.getPropertyValue("--targeted-action-anchor-inline-size")
    ).toBe("240px")
    expect(
      layer?.style.getPropertyValue("--targeted-action-anchor-block-size")
    ).toBe("48px")

    messageContainer.remove()
  })
})
