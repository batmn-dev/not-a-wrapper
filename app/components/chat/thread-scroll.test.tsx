/** @vitest-environment jsdom */

import { act, StrictMode, type ComponentProps } from "react"
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
import { ThreadScrollEdge } from "./thread-scroll"
import {
  resetThreadAnchorsForTest,
  saveThreadAnchor,
} from "./thread-scroll-anchors"

let intersectionObservers: IntersectionObserverStub[] = []

class IntersectionObserverStub {
  readonly callback: IntersectionObserverCallback
  readonly root: Element | Document | null
  readonly rootMargin: string
  readonly thresholds: readonly number[]
  readonly observed = new Set<Element>()
  disconnect = vi.fn()
  observe = vi.fn((element: Element) => this.observed.add(element))
  takeRecords = vi.fn(() => [])
  unobserve = vi.fn((element: Element) => this.observed.delete(element))

  constructor(
    callback: IntersectionObserverCallback,
    options: IntersectionObserverInit = {}
  ) {
    this.callback = callback
    this.root = options.root ?? null
    this.rootMargin = options.rootMargin ?? "0px"
    this.thresholds = Array.isArray(options.threshold)
      ? options.threshold
      : [options.threshold ?? 0]
    intersectionObservers.push(this)
  }
}

let resizeObservers: ResizeObserverStub[] = []

class ResizeObserverStub {
  readonly callback: ResizeObserverCallback
  readonly observed = new Set<Element>()

  disconnect = vi.fn()
  observe = vi.fn((element: Element) => this.observed.add(element))
  unobserve = vi.fn((element: Element) => this.observed.delete(element))

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    resizeObservers.push(this)
  }

  trigger() {
    this.callback([], this as unknown as ResizeObserver)
  }
}

type FrameCallback = (time: number) => void

describe("ThreadScrollEdge", () => {
  let container: HTMLDivElement
  let root: Root
  let nextFrameId: number
  let frames: Map<number, FrameCallback>
  let scrollIntoView: ReturnType<typeof vi.fn>
  let scrollTo: ReturnType<typeof vi.fn>
  let originalScrollIntoView: PropertyDescriptor | undefined
  let originalScrollTo: PropertyDescriptor | undefined

  beforeAll(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  beforeEach(() => {
    intersectionObservers = []
    resizeObservers = []
    nextFrameId = 0
    frames = new Map()
    scrollIntoView = vi.fn()
    scrollTo = vi.fn()
    resetThreadAnchorsForTest()
    originalScrollIntoView = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollIntoView"
    )
    originalScrollTo = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollTo"
    )

    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub)
    vi.stubGlobal("ResizeObserver", ResizeObserverStub)
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameCallback) => {
        const id = ++nextFrameId
        frames.set(id, callback)
        return id
      })
    )
    vi.stubGlobal(
      "cancelAnimationFrame",
      vi.fn((id: number) => frames.delete(id))
    )
    vi.stubGlobal("CSS", { escape: (value: string) => value })
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    })
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollTo,
    })

    container = document.createElement("div")
    container.setAttribute("data-scroll-root", "")
    Object.defineProperties(container, {
      clientHeight: { configurable: true, value: 1000 },
      scrollHeight: { configurable: true, value: 2000 },
    })
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    if (originalScrollIntoView) {
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollIntoView",
        originalScrollIntoView
      )
    } else {
      delete (HTMLElement.prototype as { scrollIntoView?: unknown })
        .scrollIntoView
    }
    if (originalScrollTo) {
      Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo)
    } else {
      delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo
    }
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function render(
    pinTurnId: string | null,
    strict = false,
    overrides: Partial<ComponentProps<typeof ThreadScrollEdge>> = {}
  ) {
    const edge = (
      <>
        <div data-turn-id="user-1" />
        <ThreadScrollEdge
          chatId="chat-1"
          streamActive={pinTurnId !== null}
          pinTurnId={pinTurnId}
          hydrated
          freshChat
          {...overrides}
        />
      </>
    )

    act(() => {
      root.render(strict ? <StrictMode>{edge}</StrictMode> : edge)
    })
  }

  function flushFrames() {
    const pending = [...frames.values()]
    frames.clear()
    act(() => {
      for (const callback of pending) callback(0)
    })
  }

  it("pins before the next animation frame in Strict Mode", () => {
    render("user-1", true)

    expect(scrollIntoView).toHaveBeenCalledOnce()
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "instant",
      block: "end",
    })
  })

  it("pins a reused turn id in a later pin cycle", () => {
    render("user-1")
    flushFrames()

    render(null)
    render("user-1")
    flushFrames()

    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })

  it("does not repin during optimistic-to-streaming reconciliation or response growth", () => {
    act(() => {
      root.render(
        <>
          <div data-turn-id="user-1" />
          <div data-turn-id="pending-assistant" />
          <ThreadScrollEdge
            chatId="chat-1"
            streamActive
            pinTurnId="user-1"
            hydrated
            freshChat
          />
        </>
      )
    })
    flushFrames()

    act(() => {
      root.render(
        <>
          <div data-turn-id="user-1" />
          <div data-turn-id="assistant-1">first content</div>
          <ThreadScrollEdge
            chatId="chat-1"
            streamActive
            pinTurnId="user-1"
            hydrated
            freshChat
          />
        </>
      )
    })
    flushFrames()

    act(() => {
      root.render(
        <>
          <div data-turn-id="user-1" />
          <div data-turn-id="assistant-1">a much taller streamed response</div>
          <ThreadScrollEdge
            chatId="chat-1"
            streamActive
            pinTurnId="user-1"
            hydrated
            freshChat
          />
        </>
      )
    })
    flushFrames()

    expect(scrollIntoView).toHaveBeenCalledOnce()
  })

  it("does not schedule a second pin when optimistic insertion already reached the edge", () => {
    container.scrollTop = 1000

    render("user-1")
    Object.defineProperty(container, "scrollHeight", {
      configurable: true,
      value: 3200,
    })
    flushFrames()

    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(container.hasAttribute("data-scroll-from-end")).toBe(false)
  })

  it("leaves manual scroll ownership released without threshold reactivation", () => {
    render("user-1")
    flushFrames()
    container.scrollTop = 640

    act(() => {
      container.dispatchEvent(new Event("scroll"))
      root.render(
        <>
          <div data-turn-id="user-1" />
          <ThreadScrollEdge
            chatId="chat-1"
            streamActive
            pinTurnId="user-1"
            hydrated
            freshChat
          />
        </>
      )
    })
    flushFrames()

    container.scrollTop = 12
    act(() => container.dispatchEvent(new Event("scroll")))
    flushFrames()

    expect(container.scrollTop).toBe(12)
    expect(scrollIntoView).toHaveBeenCalledOnce()
  })

  it("recalculates the gutter when the scroll root resizes", () => {
    render("user-1")
    flushFrames()
    const gutter = container.querySelector(
      ".threadScrollVars"
    ) as HTMLDivElement
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      bottom: 500,
    } as DOMRect)
    vi.spyOn(gutter, "getBoundingClientRect").mockReturnValue({
      top: 200,
    } as DOMRect)

    act(() => {
      for (const observer of resizeObservers) observer.trigger()
    })

    expect(
      resizeObservers.some((observer) => observer.observed.has(container))
    ).toBe(true)
    expect(gutter.style.getPropertyValue("--gutter-remaining-height")).toBe(
      "300px"
    )
    expect(scrollIntoView).toHaveBeenCalledOnce()
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it("does not repin when streaming completes", () => {
    render("user-1")
    flushFrames()

    render(null, false, { streamActive: false })
    flushFrames()

    expect(container.hasAttribute("data-stream-active")).toBe(false)
    expect(scrollIntoView).toHaveBeenCalledOnce()
  })

  it("tracks the complete root-owned bottom safe area for scroll-button visibility", () => {
    container.style.setProperty(
      "--scroll-root-safe-area-inset-bottom",
      "184px"
    )

    act(() => {
      root.render(
        <>
          <div id="thread-bottom-container" />
          <ThreadScrollEdge
            chatId="chat-1"
            streamActive={false}
            pinTurnId={null}
            hydrated
            freshChat
          />
        </>
      )
    })

    expect(
      intersectionObservers.some(
        (observer) => observer.rootMargin === "0px 0px 184px"
      )
    ).toBe(true)

    container.style.setProperty(
      "--scroll-root-safe-area-inset-bottom",
      "316px"
    )
    act(() => {
      for (const observer of resizeObservers) observer.trigger()
    })

    expect(intersectionObservers.at(-1)?.rootMargin).toBe("0px 0px 316px")
  })

  it("coalesces streamed child mutations without reading footer geometry", async () => {
    const measureFooter = vi.fn(() => ({ height: 108 }) as DOMRect)

    act(() => {
      root.render(
        <>
          <div data-turn-id="assistant-1" />
          <div
            id="thread-bottom-container"
            ref={(element) => {
              if (element) element.getBoundingClientRect = measureFooter
            }}
          />
          <ThreadScrollEdge
            chatId="chat-1"
            streamActive
            pinTurnId={null}
            hydrated
            freshChat
          />
        </>
      )
    })
    flushFrames()
    expect(measureFooter).not.toHaveBeenCalled()

    const streamedTurn = container.querySelector(
      '[data-turn-id="assistant-1"]'
    ) as HTMLElement
    const queryRoot = vi.spyOn(container, "querySelector")
    await act(async () => {
      streamedTurn.appendChild(document.createElement("span"))
      await Promise.resolve()
      streamedTurn.appendChild(document.createElement("span"))
      await Promise.resolve()
    })

    expect(frames.size).toBe(1)
    expect(measureFooter).not.toHaveBeenCalled()
    expect(
      queryRoot.mock.calls.filter(
        ([selector]) => selector === "#thread-bottom-container"
      )
    ).toHaveLength(0)

    flushFrames()
    expect(
      queryRoot.mock.calls.filter(
        ([selector]) => selector === "#thread-bottom-container"
      )
    ).toHaveLength(1)
    expect(measureFooter).not.toHaveBeenCalled()
  })

  it("cancels a pending footer refresh during cleanup", async () => {
    render(null)
    const turn = container.querySelector(
      '[data-turn-id="user-1"]'
    ) as HTMLElement

    await act(async () => {
      turn.appendChild(document.createElement("span"))
      await Promise.resolve()
    })
    expect(frames.size).toBe(1)

    act(() => root.render(<></>))

    expect(frames.size).toBe(0)
  })

  it("keeps the disclaimer in the conversation tail outside the footer", () => {
    render(null)

    const tail = container.querySelector("[data-thread-tail]")
    const disclaimer = container.querySelector("[data-thread-disclaimer]")

    expect(tail).not.toBeNull()
    expect(disclaimer).not.toBeNull()
    expect(tail?.contains(disclaimer)).toBe(true)
    expect(disclaimer?.closest("#thread-bottom-container")).toBeNull()
  })

  it("restores a saved anchor instead of jumping to the bottom", () => {
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 600,
    } as DOMRect)
    const savedTurn = document.createElement("div")
    savedTurn.setAttribute("data-turn-id-container", "m1")
    vi.spyOn(savedTurn, "getBoundingClientRect").mockReturnValue({
      top: 60,
      bottom: 160,
    } as DOMRect)
    container.appendChild(savedTurn)
    saveThreadAnchor("chat-1", container)
    savedTurn.remove()
    container.scrollTop = 0

    act(() => {
      root.render(
        <>
          <div
            ref={(element) => {
              if (!element) return
              vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
                top: 260,
                bottom: 360,
              } as DOMRect)
            }}
            data-turn-id-container="m1"
          />
          <ThreadScrollEdge
            chatId="chat-1"
            streamActive={false}
            pinTurnId={null}
            hydrated
            freshChat={false}
          />
        </>
      )
    })

    expect(scrollTo).not.toHaveBeenCalled()
    expect(container.scrollTop).toBe(200)
  })

  it("repeats the bottom fallback across two animation frames", () => {
    Object.defineProperty(container, "scrollHeight", {
      configurable: true,
      value: 1200,
    })

    render(null, false, { freshChat: false })

    expect(scrollTo).toHaveBeenCalledOnce()
    expect(scrollTo).toHaveBeenLastCalledWith({
      top: 1200,
      behavior: "instant",
    })

    flushFrames()
    expect(scrollTo).toHaveBeenCalledTimes(2)

    flushFrames()
    expect(scrollTo).toHaveBeenCalledTimes(3)
    expect(scrollTo).toHaveBeenLastCalledWith({
      top: 1200,
      behavior: "instant",
    })
  })
})
