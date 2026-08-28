/** @vitest-environment jsdom */

import { act, useState } from "react"
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
  createTurnCenterIntersectionObserver,
  createTurnIntersectionObserver,
  ThreadScrollEdge,
  TURN_CENTER_INTERSECTION_ROOT_MARGIN,
  TURN_CENTER_INTERSECTION_THRESHOLD,
  useSubmitTurnScrollRef,
  useTurnIntersectionRef,
} from "./thread-scroll"
import { resetThreadAnchorsForTest } from "./thread-scroll-anchors"

type FrameCallback = (time: number) => void

class IntersectionObserverStub implements IntersectionObserver {
  static instances: IntersectionObserverStub[] = []

  readonly root: Element | Document | null
  readonly rootMargin: string
  readonly thresholds: readonly number[]
  readonly observed = new Set<Element>()
  readonly callback: IntersectionObserverCallback

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
    IntersectionObserverStub.instances.push(this)
  }

  trigger(entry: Partial<IntersectionObserverEntry>) {
    this.callback(
      [
        {
          boundingClientRect: {} as DOMRectReadOnly,
          intersectionRatio: entry.isIntersecting ? 1 : 0,
          intersectionRect: {} as DOMRectReadOnly,
          isIntersecting: false,
          rootBounds: null,
          target: [...this.observed][0] ?? document.body,
          time: 0,
          ...entry,
        },
      ],
      this
    )
  }
}

function SubmitTarget({ active }: { active: boolean }) {
  const ref = useSubmitTurnScrollRef(active)
  return (
    <div data-turn-id-container="user-1">
      <section ref={ref} data-turn-id-container="user-1" />
    </div>
  )
}

function IntersectionTarget({
  onChange,
}: {
  onChange: (intersecting: boolean) => void
}) {
  const ref = useTurnIntersectionRef(onChange)
  return (
    <div data-turn-id-container="turn-1">
      <section ref={ref} data-turn-id-container="turn-1" />
    </div>
  )
}

describe("thread scroll contract", () => {
  let container: HTMLDivElement
  let root: Root
  let frames: Map<number, FrameCallback>
  let nextFrameId: number
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
    IntersectionObserverStub.instances = []
    resetThreadAnchorsForTest()
    frames = new Map()
    nextFrameId = 0
    scrollIntoView = vi.fn()
    scrollTo = vi.fn()
    originalScrollIntoView = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollIntoView"
    )
    originalScrollTo = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollTo"
    )
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub)
    vi.stubGlobal("CSS", { escape: (value: string) => value })
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
      Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView")
    }
    if (originalScrollTo) {
      Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo)
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollTo")
    }
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("gates the shared observer by threshold and tears down per scroll root", () => {
    const turn = document.createElement("div")
    container.appendChild(turn)
    const onChange = vi.fn()
    const observer = createTurnIntersectionObserver({
      rootMargin: "10px",
      threshold: 0.5,
    })

    const cleanup = observer.observe(turn, onChange)
    const instance = IntersectionObserverStub.instances[0]
    expect(instance?.root).toBe(container)
    expect(instance?.rootMargin).toBe("10px")
    expect(instance?.thresholds).toEqual([0.5])

    instance?.trigger({
      intersectionRatio: 0.499,
      isIntersecting: true,
      target: turn,
    })
    expect(onChange.mock.calls.at(-1)?.[0]).toBe(false)
    instance?.trigger({
      intersectionRatio: 0.5,
      isIntersecting: true,
      target: turn,
    })
    expect(onChange.mock.calls.at(-1)?.[0]).toBe(true)

    cleanup()
    expect(instance?.unobserve).toHaveBeenCalledWith(turn)
    expect(instance?.disconnect).toHaveBeenCalledOnce()
  })

  it("shares the exact center-band observer per scroll root", () => {
    const first = document.createElement("div")
    const second = document.createElement("div")
    container.append(first, second)
    const observer = createTurnCenterIntersectionObserver()

    const cleanupFirst = observer.observe(first, vi.fn())
    const cleanupSecond = observer.observe(second, vi.fn())
    const instance = IntersectionObserverStub.instances[0]

    expect(IntersectionObserverStub.instances).toHaveLength(1)
    expect(instance?.root).toBe(container)
    expect(instance?.rootMargin).toBe(TURN_CENTER_INTERSECTION_ROOT_MARGIN)
    expect(instance?.thresholds).toEqual([TURN_CENTER_INTERSECTION_THRESHOLD])
    expect(instance?.observed).toEqual(new Set([first, second]))

    cleanupFirst()
    expect(instance?.disconnect).not.toHaveBeenCalled()
    cleanupSecond()
    expect(instance?.disconnect).toHaveBeenCalledOnce()
  })

  function flushOneFrame() {
    const pending = [...frames.values()]
    frames.clear()
    act(() => {
      for (const callback of pending) callback(0)
    })
  }

  it("lets the active user turn scroll smoothly after exactly two frames", () => {
    container.setAttribute("data-scroll-from-end", "")
    act(() => root.render(<SubmitTarget active />))

    expect(scrollIntoView).not.toHaveBeenCalled()
    flushOneFrame()
    expect(scrollIntoView).not.toHaveBeenCalled()
    flushOneFrame()

    expect(container.hasAttribute("data-scroll-from-end")).toBe(false)
    expect(scrollIntoView).toHaveBeenCalledOnce()
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "end",
    })
  })

  it("does not issue a second command as pending content becomes streamed content", () => {
    function Harness() {
      const [content, setContent] = useState("pending")
      return (
        <>
          <SubmitTarget active />
          <button onClick={() => setContent("streaming")}>{content}</button>
        </>
      )
    }

    act(() => root.render(<Harness />))
    flushOneFrame()
    flushOneFrame()
    act(() => container.querySelector("button")?.click())
    flushOneFrame()
    flushOneFrame()

    expect(scrollIntoView).toHaveBeenCalledOnce()
  })

  it("observes the turn section through the exact center band", () => {
    const onChange = vi.fn()
    act(() => root.render(<IntersectionTarget onChange={onChange} />))

    const section = container.querySelector("section")
    const observer = IntersectionObserverStub.instances[0]

    expect(observer?.root).toBe(container)
    expect(observer?.rootMargin).toBe("-49% 0px -49% 0px")
    expect(observer?.thresholds).toEqual([0])
    expect(observer?.observed.has(section as Element)).toBe(true)

    act(() => observer?.trigger({ isIntersecting: false }))
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it("matches the fixed sentinel and entry-owned gutter observers", () => {
    act(() => {
      root.render(
        <ThreadScrollEdge
          chatId="chat-1"
          streamActive={false}
          hydrated
          freshChat
        />
      )
    })

    const sentinelObserver = IntersectionObserverStub.instances.find(
      (observer) => observer.rootMargin === "0px 0px 96px"
    )
    const gutterObserver = IntersectionObserverStub.instances.find(
      (observer) => observer.thresholds.length === 101
    )
    const gutter = container.querySelector<HTMLElement>(".threadScrollVars")

    expect(sentinelObserver).toBeTruthy()
    expect(gutterObserver).toBeTruthy()
    expect(gutter?.hasAttribute("aria-hidden")).toBe(false)

    act(() => {
      sentinelObserver?.trigger({ isIntersecting: false })
      gutterObserver?.trigger({
        boundingClientRect: { top: 240 } as DOMRectReadOnly,
        rootBounds: { bottom: 600 } as DOMRectReadOnly,
      })
    })

    expect(container.hasAttribute("data-scroll-from-end")).toBe(true)
    expect(gutter?.style.getPropertyValue("--gutter-remaining-height")).toBe(
      "360px"
    )
  })

  it("restores an unsaved thread with the exact two-frame bottom fallback", () => {
    act(() => {
      root.render(
        <ThreadScrollEdge
          chatId="chat-1"
          streamActive={false}
          hydrated
          freshChat={false}
        />
      )
    })

    expect(container.scrollTop).toBe(0)
    expect(scrollTo).not.toHaveBeenCalled()

    const firstFrame = frames.entries().next().value
    expect(firstFrame).toBeTruthy()
    if (firstFrame) {
      frames.delete(firstFrame[0])
      act(() => firstFrame[1](0))
    }
    expect(container.scrollTop).toBe(container.scrollHeight)

    const secondFrame = frames.entries().next().value
    expect(secondFrame).toBeTruthy()
    if (secondFrame) {
      frames.delete(secondFrame[0])
      act(() => secondFrame[1](16))
    }
    expect(container.scrollTop).toBe(container.scrollHeight)
    expect(frames.size).toBe(0)
  })

  it("keeps the disclaimer in the conversation tail outside the footer", () => {
    act(() => {
      root.render(
        <ThreadScrollEdge
          chatId="chat-1"
          streamActive={false}
          hydrated
          freshChat
        />
      )
    })
    const tail = container.querySelector("[data-thread-tail]")
    const disclaimer = container.querySelector("[data-thread-disclaimer]")
    expect(tail?.contains(disclaimer)).toBe(true)
    expect(disclaimer?.closest("#thread-bottom-container")).toBeNull()
  })
})
