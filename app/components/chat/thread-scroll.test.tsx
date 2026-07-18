/** @vitest-environment jsdom */

import { act, type ComponentProps, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import {
  resetThreadAnchorsForTest,
  saveThreadAnchor,
} from "./thread-scroll-anchors"
import { ThreadScrollEdge } from "./thread-scroll"

class IntersectionObserverStub {
  readonly root = null
  readonly rootMargin = "0px"
  readonly thresholds = []

  disconnect = vi.fn()
  observe = vi.fn()
  takeRecords = vi.fn(() => [])
  unobserve = vi.fn()
}

let resizeObservers: ResizeObserverStub[] = []

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
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollTo",
        originalScrollTo
      )
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

  it("pins after Strict Mode cancels the first effect pass", () => {
    render("user-1", true)
    flushFrames()

    expect(scrollIntoView).toHaveBeenCalledOnce()
  })

  it("pins a reused turn id in a later pin cycle", () => {
    render("user-1")
    flushFrames()

    render(null)
    render("user-1")
    flushFrames()

    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })

  it("recalculates the gutter when the scroll root resizes", () => {
    render(null)
    const gutter = container.lastElementChild as HTMLDivElement
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      bottom: 500,
    } as DOMRect)
    vi.spyOn(gutter, "getBoundingClientRect").mockReturnValue({
      top: 200,
    } as DOMRect)

    act(() => resizeObservers[0].trigger())

    expect(resizeObservers[0].observe).toHaveBeenCalledWith(container)
    expect(gutter.style.getPropertyValue("--gutter-remaining-height")).toBe(
      "300px"
    )
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
