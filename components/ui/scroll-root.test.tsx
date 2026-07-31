/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { ScrollRoot, useStickyPaddingBottom } from "./scroll-root"

class ResizeObserverStub {
  readonly callback: ResizeObserverCallback

  disconnect = vi.fn()
  observe = vi.fn()
  unobserve = vi.fn()

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    resizeObservers.push(this)
  }

  trigger() {
    this.callback([], this as unknown as ResizeObserver)
  }
}

class VisualViewportStub extends EventTarget {
  height = 800
  offsetTop = 0
  scale = 1
}

let resizeObservers: ResizeObserverStub[] = []
let animationFrames = new Map<number, FrameRequestCallback>()
let nextAnimationFrameId = 1

function StickyFooterFixture({
  headerPosition,
}: {
  headerPosition: "absolute" | "static"
}) {
  const footerRef = useStickyPaddingBottom(true)

  return (
    <div id="thread-bottom-container" ref={footerRef}>
      <div data-thread-footer-overflow-spacer="" />
      <div
        data-prompt-textarea-header=""
        style={{ position: headerPosition }}
      />
    </div>
  )
}

describe("ScrollRoot viewport and footer measurement", () => {
  let container: HTMLDivElement
  let root: Root
  let viewport: VisualViewportStub
  let originalVisualViewport: PropertyDescriptor | undefined
  let originalInnerHeight: PropertyDescriptor | undefined
  let originalClientHeight: PropertyDescriptor | undefined

  function setLayoutViewportHeight(height: number) {
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: height,
    })
    Object.defineProperty(document.documentElement, "clientHeight", {
      configurable: true,
      value: height,
    })
  }

  function flushViewportResize() {
    act(() => {
      window.dispatchEvent(new Event("resize"))
      viewport.dispatchEvent(new Event("resize"))
    })
    act(() => {
      const callbacks = [...animationFrames.values()]
      animationFrames.clear()
      for (const callback of callbacks) callback(0)
    })
  }

  beforeAll(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  beforeEach(() => {
    resizeObservers = []
    animationFrames = new Map()
    nextAnimationFrameId = 1
    viewport = new VisualViewportStub()
    originalVisualViewport = Object.getOwnPropertyDescriptor(
      window,
      "visualViewport"
    )
    originalInnerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight")
    originalClientHeight = Object.getOwnPropertyDescriptor(
      document.documentElement,
      "clientHeight"
    )
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: viewport,
    })
    setLayoutViewportHeight(800)
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextAnimationFrameId++
      animationFrames.set(id, callback)
      return id
    })
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      animationFrames.delete(id)
    })
    vi.stubGlobal("ResizeObserver", ResizeObserverStub)

    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    if (originalVisualViewport) {
      Object.defineProperty(window, "visualViewport", originalVisualViewport)
    } else {
      delete (window as { visualViewport?: VisualViewport }).visualViewport
    }
    if (originalInnerHeight) {
      Object.defineProperty(window, "innerHeight", originalInnerHeight)
    }
    if (originalClientHeight) {
      Object.defineProperty(
        document.documentElement,
        "clientHeight",
        originalClientHeight
      )
    } else {
      Reflect.deleteProperty(document.documentElement, "clientHeight")
    }
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("ignores a desktop viewport resize while the editor is focused", () => {
    act(() => {
      root.render(
        <ScrollRoot>
          <textarea data-virtualkeyboard="true" autoFocus />
        </ScrollRoot>
      )
    })

    const scrollRoot = container.querySelector(
      "[data-scroll-root]"
    ) as HTMLElement

    setLayoutViewportHeight(500)
    viewport.height = 500
    flushViewportResize()

    expect(scrollRoot.style.getPropertyValue("--screen-keyboard-height")).toBe(
      "0px"
    )
    expect(scrollRoot.hasAttribute("data-keyboard-open")).toBe(false)

    setLayoutViewportHeight(800)
    viewport.height = 800
    flushViewportResize()
    setLayoutViewportHeight(500)
    viewport.height = 500
    flushViewportResize()

    expect(scrollRoot.style.getPropertyValue("--screen-keyboard-height")).toBe(
      "0px"
    )
    expect(scrollRoot.hasAttribute("data-keyboard-open")).toBe(false)
  })

  it("ignores a desktop viewport resize while the editor is unfocused", () => {
    act(() => {
      root.render(
        <ScrollRoot>
          <textarea data-virtualkeyboard="true" />
        </ScrollRoot>
      )
    })

    const scrollRoot = container.querySelector(
      "[data-scroll-root]"
    ) as HTMLElement

    setLayoutViewportHeight(500)
    viewport.height = 500
    flushViewportResize()

    expect(scrollRoot.style.getPropertyValue("--screen-keyboard-height")).toBe(
      "0px"
    )
    expect(scrollRoot.hasAttribute("data-keyboard-open")).toBe(false)
  })

  it("writes an inset for a focused editor when only the visual viewport contracts", () => {
    viewport.height = 500

    act(() => {
      root.render(
        <ScrollRoot>
          <textarea data-virtualkeyboard="true" autoFocus />
        </ScrollRoot>
      )
    })

    const scrollRoot = container.querySelector(
      "[data-scroll-root]"
    ) as HTMLElement

    expect(scrollRoot.style.getPropertyValue("--screen-keyboard-height")).toBe(
      "300px"
    )
    expect(scrollRoot.hasAttribute("data-keyboard-open")).toBe(true)
  })

  it("restores and recomputes the keyboard inset without retaining stale state", () => {
    act(() => {
      root.render(
        <ScrollRoot>
          <textarea data-virtualkeyboard="true" autoFocus />
        </ScrollRoot>
      )
    })

    const scrollRoot = container.querySelector(
      "[data-scroll-root]"
    ) as HTMLElement

    viewport.height = 500
    flushViewportResize()
    expect(scrollRoot.style.getPropertyValue("--screen-keyboard-height")).toBe(
      "300px"
    )

    viewport.height = 800
    flushViewportResize()
    expect(scrollRoot.style.getPropertyValue("--screen-keyboard-height")).toBe(
      "0px"
    )
    expect(scrollRoot.hasAttribute("data-keyboard-open")).toBe(false)

    viewport.height = 620
    flushViewportResize()
    expect(scrollRoot.style.getPropertyValue("--screen-keyboard-height")).toBe(
      "180px"
    )

    viewport.height = 800
    flushViewportResize()
    expect(scrollRoot.style.getPropertyValue("--screen-keyboard-height")).toBe(
      "0px"
    )
    expect(scrollRoot.hasAttribute("data-keyboard-open")).toBe(false)
  })

  it("preserves an explicit root-level keyboard fixture override", () => {
    viewport.height = 500

    act(() => {
      root.render(
        <ScrollRoot
          data-screen-keyboard-height-override=""
          style={
            {
              "--screen-keyboard-height": "280px",
            } as React.CSSProperties
          }
        >
          <textarea data-virtualkeyboard="true" autoFocus />
        </ScrollRoot>
      )
    })

    const scrollRoot = container.querySelector(
      "[data-scroll-root]"
    ) as HTMLElement

    expect(scrollRoot.style.getPropertyValue("--screen-keyboard-height")).toBe(
      "280px"
    )
  })

  it("reserves an absolute prompt header before measuring the sticky root", () => {
    act(() => {
      root.render(
        <ScrollRoot>
          <StickyFooterFixture headerPosition="absolute" />
        </ScrollRoot>
      )
    })

    const scrollRoot = container.querySelector(
      "[data-scroll-root]"
    ) as HTMLElement
    const footer = container.querySelector(
      "#thread-bottom-container"
    ) as HTMLElement
    const header = container.querySelector(
      "[data-prompt-textarea-header]"
    ) as HTMLElement
    const spacer = container.querySelector(
      "[data-thread-footer-overflow-spacer]"
    ) as HTMLElement

    vi.spyOn(footer, "getBoundingClientRect").mockReturnValue({
      height: 116,
    } as DOMRect)
    vi.spyOn(header, "getBoundingClientRect").mockReturnValue({
      height: 20,
    } as DOMRect)

    act(() => {
      for (const observer of resizeObservers) observer.trigger()
    })

    expect(resizeObservers[0]?.observe).toHaveBeenCalledWith(footer, {
      box: "border-box",
    })
    expect(resizeObservers[0]?.observe).toHaveBeenCalledWith(header, {
      box: "border-box",
    })
    expect(spacer.style.height).toBe("20px")
    expect(scrollRoot.style.getPropertyValue("--sticky-padding-bottom")).toBe(
      "116px"
    )

    act(() => {
      root.render(
        <ScrollRoot>
          <StickyFooterFixture headerPosition="static" />
        </ScrollRoot>
      )
    })
    act(() => {
      for (const observer of resizeObservers) observer.trigger()
    })

    expect(spacer.style.height).toBe("0px")
  })

  it("keeps native scroll anchoring enabled while a stream is active", () => {
    act(() => {
      root.render(
        <ScrollRoot data-stream-active="">
          <div />
        </ScrollRoot>
      )
    })

    const scrollRoot = container.querySelector(
      "[data-scroll-root]"
    ) as HTMLElement

    expect(scrollRoot.hasAttribute("data-stream-active")).toBe(true)
    expect(scrollRoot.className).not.toContain("[overflow-anchor:none]")
  })
})
