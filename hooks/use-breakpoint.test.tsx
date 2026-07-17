/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { useBreakpoint } from "./use-breakpoint"

type MediaListener = () => void

function BreakpointValue({
  onRender,
}: {
  onRender?: (value: boolean) => void
}) {
  const value = useBreakpoint(768)
  onRender?.(value)
  return <output>{String(value)}</output>
}

describe("responsive hooks", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null
  let listener: MediaListener | null = null
  const removeEventListener = vi.fn()

  beforeAll(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    if (root) act(() => root?.unmount())
    container?.remove()
    container = null
    root = null
    listener = null
    removeEventListener.mockReset()
    vi.restoreAllMocks()
  })

  function setViewport(width: number) {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: width,
    })
  }

  function mockMatchMedia() {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn((query: string) => ({
        matches: window.innerWidth < 768,
        media: query,
        onchange: null,
        addEventListener: (_type: string, next: MediaListener) => {
          listener = next
        },
        removeEventListener,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  }

  function render(value: React.ReactNode) {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(value))
  }

  it("keeps the server snapshot false, then matches below 768 at max-width 767px", () => {
    expect(renderToStaticMarkup(<BreakpointValue />)).toContain("false")

    setViewport(767)
    mockMatchMedia()
    const renderedValues: boolean[] = []
    render(<BreakpointValue onRender={(value) => renderedValues.push(value)} />)

    expect(window.matchMedia).toHaveBeenCalledWith("(max-width: 767px)")
    expect(renderedValues[0]).toBe(false)
    expect(renderedValues.at(-1)).toBe(true)
    expect(container?.textContent).toBe("true")

    setViewport(768)
    act(() => listener?.())
    expect(container?.textContent).toBe("false")
  })

})
