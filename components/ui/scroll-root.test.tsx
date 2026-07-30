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

  beforeAll(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  beforeEach(() => {
    resizeObservers = []
    viewport = new VisualViewportStub()
    originalVisualViewport = Object.getOwnPropertyDescriptor(
      window,
      "visualViewport"
    )
    originalInnerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight")
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: viewport,
    })
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
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
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("writes the visual-viewport keyboard inset only for opted-in editors", () => {
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
