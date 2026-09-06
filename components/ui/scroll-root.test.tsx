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
import {
  ScrollRoot,
  useScrollRoot,
  useStickyPaddingBottom,
} from "./scroll-root"

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

class VirtualKeyboardStub extends EventTarget {
  overlaysContent = false
  boundingRect = { height: 0 } as DOMRectReadOnly

  setHeight(height: number) {
    this.boundingRect = { height } as DOMRectReadOnly
    this.dispatchEvent(new Event("geometrychange"))
  }
}

let resizeObservers: ResizeObserverStub[] = []
let animationFrames = new Map<number, FrameRequestCallback>()
let nextAnimationFrameId = 1

function StickyFooterFixture({
  headerPosition,
}: {
  headerPosition: "absolute" | "static"
}) {
  const footerRef = useStickyPaddingBottom()

  return (
    <div id="thread-bottom-container" ref={footerRef}>
      <div data-thread-footer-overflow-spacer="" />
      <div data-composer-keyboard-pin="" />
      <div
        data-prompt-textarea-header=""
        style={{ position: headerPosition }}
      />
    </div>
  )
}

function ScrollModeFixture() {
  const { setScrollRootMode } = useScrollRoot()

  return (
    <>
      <button
        type="button"
        onClick={() => setScrollRootMode("expanded-composer", true)}
      >
        Expand composer
      </button>
      <button
        type="button"
        onClick={() => setScrollRootMode("voice-focus-mode", true)}
      >
        Enter voice focus
      </button>
    </>
  )
}

describe("ScrollRoot viewport and footer measurement", () => {
  let container: HTMLDivElement
  let root: Root
  let viewport: VisualViewportStub
  let originalVisualViewport: PropertyDescriptor | undefined
  let originalInnerHeight: PropertyDescriptor | undefined
  let originalClientHeight: PropertyDescriptor | undefined
  let originalVirtualKeyboard: PropertyDescriptor | undefined

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
    originalVirtualKeyboard = Object.getOwnPropertyDescriptor(
      navigator,
      "virtualKeyboard"
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
    if (originalVirtualKeyboard) {
      Object.defineProperty(
        navigator,
        "virtualKeyboard",
        originalVirtualKeyboard
      )
    } else {
      Reflect.deleteProperty(navigator, "virtualKeyboard")
    }
    document.documentElement.classList.remove("keyboard-open")
    document.body.style.removeProperty("--screen-keyboard-height")
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("opts the thread root into the shared scrollable-surface contract", () => {
    act(() => {
      root.render(<ScrollRoot>Thread</ScrollRoot>)
    })

    expect(
      container
        .querySelector("[data-scroll-root]")
        ?.hasAttribute("data-scrollable-surface")
    ).toBe(true)
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

    expect(
      document.body.style.getPropertyValue("--screen-keyboard-height")
    ).toBe("0px")
    expect(scrollRoot.hasAttribute("data-keyboard-open")).toBe(false)

    setLayoutViewportHeight(800)
    viewport.height = 800
    flushViewportResize()
    setLayoutViewportHeight(500)
    viewport.height = 500
    flushViewportResize()

    expect(
      document.body.style.getPropertyValue("--screen-keyboard-height")
    ).toBe("0px")
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

    expect(
      document.body.style.getPropertyValue("--screen-keyboard-height")
    ).toBe("0px")
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

    flushViewportResize()

    expect(
      document.body.style.getPropertyValue("--screen-keyboard-height")
    ).toBe("300px")
    expect(scrollRoot.hasAttribute("data-keyboard-open")).toBe(true)
    expect(document.documentElement.classList).toContain("keyboard-open")
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
    expect(
      document.body.style.getPropertyValue("--screen-keyboard-height")
    ).toBe("300px")

    viewport.height = 800
    flushViewportResize()
    expect(
      document.body.style.getPropertyValue("--screen-keyboard-height")
    ).toBe("0px")
    expect(scrollRoot.hasAttribute("data-keyboard-open")).toBe(false)

    viewport.height = 620
    flushViewportResize()
    expect(
      document.body.style.getPropertyValue("--screen-keyboard-height")
    ).toBe("180px")

    viewport.height = 800
    flushViewportResize()
    expect(
      document.body.style.getPropertyValue("--screen-keyboard-height")
    ).toBe("0px")
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

  it("uses Virtual Keyboard geometry in overlay mode and restores browser ownership", () => {
    const keyboard = new VirtualKeyboardStub()
    Object.defineProperty(navigator, "virtualKeyboard", {
      configurable: true,
      value: keyboard,
    })

    act(() => {
      root.render(
        <ScrollRoot>
          <textarea data-virtualkeyboard="true" />
        </ScrollRoot>
      )
    })

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement
    const scrollRoot = container.querySelector(
      "[data-scroll-root]"
    ) as HTMLElement
    act(() => textarea.focus())
    act(() => keyboard.setHeight(312))

    expect(keyboard.overlaysContent).toBe(true)
    expect(
      document.body.style.getPropertyValue("--screen-keyboard-height")
    ).toBe("312px")
    expect(document.documentElement.classList).toContain("keyboard-open")
    expect(scrollRoot.hasAttribute("data-keyboard-open")).toBe(true)

    act(() => textarea.blur())
    act(() => {
      const callbacks = [...animationFrames.values()]
      animationFrames.clear()
      for (const callback of callbacks) callback(0)
    })

    expect(document.documentElement.classList).not.toContain("keyboard-open")
    expect(
      document.body.style.getPropertyValue("--screen-keyboard-height")
    ).toBe("")

    act(() => root.unmount())
    expect(keyboard.overlaysContent).toBe(false)
    root = createRoot(container)
  })

  it("preserves Virtual Keyboard ownership across route-content handoffs", () => {
    const keyboard = new VirtualKeyboardStub()
    const removeKeyboardListener = vi.spyOn(keyboard, "removeEventListener")
    Object.defineProperty(navigator, "virtualKeyboard", {
      configurable: true,
      value: keyboard,
    })

    act(() => {
      root.render(
        <ScrollRoot>
          <textarea key="first-route" data-route="first" />
        </ScrollRoot>
      )
    })

    const firstEditor = container.querySelector(
      "[data-route='first']"
    ) as HTMLTextAreaElement
    const originalScrollRoot = container.querySelector(
      "[data-scroll-root]"
    ) as HTMLElement
    act(() => firstEditor.focus())
    act(() => keyboard.setHeight(312))

    act(() => {
      root.render(
        <ScrollRoot>
          <textarea key="second-route" data-route="second" />
        </ScrollRoot>
      )
    })

    const secondEditor = container.querySelector(
      "[data-route='second']"
    ) as HTMLTextAreaElement
    const settledScrollRoot = container.querySelector(
      "[data-scroll-root]"
    ) as HTMLElement

    expect(settledScrollRoot).toBe(originalScrollRoot)
    expect(removeKeyboardListener).not.toHaveBeenCalledWith(
      "geometrychange",
      expect.any(Function)
    )
    expect(
      document.body.style.getPropertyValue("--screen-keyboard-height")
    ).toBe("312px")

    act(() => secondEditor.focus())
    act(() => {
      const callbacks = [...animationFrames.values()]
      animationFrames.clear()
      for (const callback of callbacks) callback(0)
    })
    act(() => keyboard.setHeight(284))

    expect(
      document.body.style.getPropertyValue("--screen-keyboard-height")
    ).toBe("284px")
    expect(settledScrollRoot.hasAttribute("data-keyboard-open")).toBe(true)
    expect(document.documentElement.classList).toContain("keyboard-open")
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
    const composer = container.querySelector(
      "[data-composer-keyboard-pin]"
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
    vi.spyOn(composer, "getBoundingClientRect").mockReturnValue({
      height: 52,
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
    expect(resizeObservers[0]?.observe).toHaveBeenCalledWith(composer, {
      box: "border-box",
    })
    expect(spacer.style.height).toBe("20px")
    expect(scrollRoot.style.getPropertyValue("--sticky-padding-bottom")).toBe(
      "116px"
    )
    expect(scrollRoot.style.getPropertyValue("--composer-height")).toBe("52px")

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

  it("applies stream state to root anchoring and descendant variants", () => {
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
    expect(scrollRoot.className).toContain(
      "data-stream-active:[overflow-anchor:none]"
    )
  })

  it("owns expanded-composer scroll locking on the root", () => {
    act(() => {
      root.render(
        <ScrollRoot>
          <ScrollModeFixture />
        </ScrollRoot>
      )
    })

    const scrollRoot = container.querySelector(
      "[data-scroll-root]"
    ) as HTMLElement
    const buttons = container.querySelectorAll("button")

    expect(scrollRoot.className).toContain(
      "not-print:data-expanded-composer:overflow-y-hidden!"
    )
    act(() => buttons[0]?.click())
    expect(scrollRoot.hasAttribute("data-expanded-composer")).toBe(true)
    act(() => buttons[1]?.click())
    expect(scrollRoot.hasAttribute("data-voice-focus-mode")).toBe(true)
    expect(scrollRoot.className).toContain(
      "not-print:data-voice-focus-mode:overflow-y-hidden!"
    )
  })

  it("exposes the complete fixed-header and safe-area variable contract", () => {
    act(() => {
      root.render(
        <ScrollRoot>
          <header data-fixed-header="never" />
        </ScrollRoot>
      )
    })

    const scrollRoot = container.querySelector(
      "[data-scroll-root]"
    ) as HTMLElement

    expect(scrollRoot.className).toContain(
      "has-data-[fixed-header=never]:[--sticky-padding-top:0px]"
    )
    expect(scrollRoot.className).toContain(
      "has-data-[fixed-header=less-than-md]:md:[--sticky-padding-top:0px]"
    )
    expect(scrollRoot.className).toContain(
      "has-data-[fixed-header=less-than-xl]:@w-xl/main:[--sticky-padding-top:0px]"
    )
    expect(scrollRoot.className).toContain(
      "has-data-[fixed-header=less-than-xxl]:@w-2xl/main:[--sticky-padding-top:0px]"
    )
    expect(scrollRoot.className).toContain(
      "[--scroll-root-safe-area-inset-bottom:calc(var(--sticky-padding-bottom)+var(--screen-keyboard-height,0px)+env(safe-area-inset-bottom,0px))]"
    )
    expect(scrollRoot.className).toContain("touch:[scrollbar-width:none]")
  })
})
