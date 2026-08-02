/** @vitest-environment jsdom */
import React, { act, createRef } from "react"
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
    const messageContainerRef = createRef<HTMLElement>()
    messageContainerRef.current = messageContainer

    act(() => {
      root.render(
        <QuoteButton
          mousePosition={{ x: 120, y: 160 }}
          onQuote={() => undefined}
          messageContainerRef={messageContainerRef}
          onDismiss={() => undefined}
        />
      )
    })

    const button = container.querySelector("button")
    const positioner = button?.parentElement

    expect(button?.textContent).toBe("Add to chat")
    expect(positioner?.style.left).toBe("100px")
    expect(positioner?.style.top).toBe("60px")
    expect(positioner?.style.transform).toBe("translateX(-50%)")
  })
})
