/** @vitest-environment jsdom */

import { act, type ComponentProps, type RefCallback } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import {
  useActivityPanelScrollFollow,
  type ActivityPanelScrollFollow,
} from "./use-activity-panel-scroll-follow"

type FrameCallback = (time: number) => void

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

function Harness({
  turnKey,
  startAtEnd,
  scrollHeight = 1000,
  clientHeight = 400,
}: {
  turnKey: string
  startAtEnd: boolean
  scrollHeight?: number
  clientHeight?: number
}) {
  const { viewportRef, contentRef } = useActivityPanelScrollFollow({
    turnKey,
    startAtEnd,
  })

  return (
    <div
      ref={viewportRef}
      data-testid="viewport"
      data-scroll-height={scrollHeight}
      data-client-height={clientHeight}
    >
      <div ref={contentRef} data-testid="content" />
    </div>
  )
}

function CaptureHarness({
  onFollower,
}: {
  onFollower: (follower: ActivityPanelScrollFollow) => void
}) {
  const follower = useActivityPanelScrollFollow({
    turnKey: "turn-1",
    startAtEnd: true,
  })
  const captureRef: RefCallback<HTMLDivElement> = (node) => {
    if (node !== null) onFollower(follower)
  }
  return <div ref={captureRef} />
}

function attach<T>(ref: RefCallback<T>, node: T): () => void {
  const cleanup = ref(node)
  if (typeof cleanup !== "function") {
    throw new Error("Expected callback ref cleanup")
  }
  return cleanup
}

describe("useActivityPanelScrollFollow", () => {
  let container: HTMLDivElement
  let root: Root
  let frames: Map<number, FrameCallback>
  let nextFrameId: number
  let scroll: ReturnType<typeof vi.fn>

  beforeAll(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  beforeEach(() => {
    resizeObservers = []
    frames = new Map()
    nextFrameId = 0
    scroll = vi.fn(function (
      this: HTMLElement,
      options: ScrollToOptions
    ) {
      if (options.top !== undefined) this.scrollTop = options.top
    })

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
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return Number((this as HTMLElement).dataset.scrollHeight ?? 0)
      },
    })
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return Number((this as HTMLElement).dataset.clientHeight ?? 0)
      },
    })
    Object.defineProperty(Element.prototype, "scroll", {
      configurable: true,
      value: scroll,
    })

    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(Element.prototype, "scroll")
    Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight")
    Reflect.deleteProperty(HTMLElement.prototype, "clientHeight")
  })

  function render(props: ComponentProps<typeof Harness>) {
    act(() => root.render(<Harness {...props} />))
  }

  function viewport(): HTMLDivElement {
    const node = container.querySelector<HTMLDivElement>(
      '[data-testid="viewport"]'
    )
    if (!node) throw new Error("Missing viewport")
    return node
  }

  function latestObserver(): ResizeObserverStub {
    const observer = resizeObservers.at(-1)
    if (!observer) throw new Error("Missing ResizeObserver")
    return observer
  }

  function flushFrames() {
    const pending = [...frames.values()]
    frames.clear()
    act(() => {
      for (const callback of pending) callback(0)
    })
  }

  function finishInitialAlignment() {
    flushFrames()
    scroll.mockClear()
  }

  it("aligns a live panel opened midway to the end", () => {
    render({ turnKey: "turn-1", startAtEnd: true })

    flushFrames()

    expect(scroll).toHaveBeenCalledOnce()
    expect(scroll).toHaveBeenCalledWith({ top: 1000, behavior: "instant" })
  })

  it("follows pinned content growth and coalesces notifications per frame", () => {
    render({ turnKey: "turn-1", startAtEnd: true })
    finishInitialAlignment()
    viewport().dataset.scrollHeight = "1200"

    act(() => {
      latestObserver().trigger()
      latestObserver().trigger()
    })
    flushFrames()

    expect(scroll).toHaveBeenCalledOnce()
    expect(scroll).toHaveBeenCalledWith({ top: 1200, behavior: "instant" })
  })

  it("re-checks pinned state when the user scrolls before a queued frame", () => {
    render({ turnKey: "turn-1", startAtEnd: true })
    finishInitialAlignment()
    viewport().dataset.scrollHeight = "1200"
    act(() => latestObserver().trigger())

    viewport().scrollTop = 0
    act(() => viewport().dispatchEvent(new Event("scroll")))
    flushFrames()

    expect(scroll).not.toHaveBeenCalled()
  })

  it("suspends while scrolled up and resumes within the bottom threshold", () => {
    render({ turnKey: "turn-1", startAtEnd: true })
    finishInitialAlignment()

    viewport().scrollTop = 100
    act(() => viewport().dispatchEvent(new Event("scroll")))
    viewport().dataset.scrollHeight = "1200"
    act(() => latestObserver().trigger())
    flushFrames()
    expect(scroll).not.toHaveBeenCalled()

    viewport().scrollTop = 776
    act(() => viewport().dispatchEvent(new Event("scroll")))
    viewport().dataset.scrollHeight = "1250"
    act(() => latestObserver().trigger())
    flushFrames()
    expect(scroll).toHaveBeenCalledOnce()
  })

  it("treats exactly 24px and negative sub-pixel end distances as pinned", () => {
    render({ turnKey: "turn-1", startAtEnd: false })

    viewport().scrollTop = 576
    act(() => viewport().dispatchEvent(new Event("scroll")))
    viewport().dataset.scrollHeight = "1100"
    act(() => latestObserver().trigger())
    flushFrames()
    expect(scroll).toHaveBeenCalledOnce()

    scroll.mockClear()
    viewport().dataset.scrollHeight = "1100"
    viewport().scrollTop = 700.25
    act(() => viewport().dispatchEvent(new Event("scroll")))
    viewport().dataset.scrollHeight = "1200"
    act(() => latestObserver().trigger())
    flushFrames()
    expect(scroll).toHaveBeenCalledOnce()
  })

  it("follows terminal growth while pinned without settlement counters", () => {
    render({ turnKey: "turn-1", startAtEnd: true })
    finishInitialAlignment()
    viewport().dataset.scrollHeight = "1080"

    act(() => latestObserver().trigger())
    flushFrames()

    expect(scroll).toHaveBeenCalledWith({ top: 1080, behavior: "instant" })
  })

  it("does not move settled growth while the user is scrolled up", () => {
    render({ turnKey: "turn-1", startAtEnd: true })
    finishInitialAlignment()
    viewport().scrollTop = 0
    act(() => viewport().dispatchEvent(new Event("scroll")))
    viewport().dataset.scrollHeight = "1080"

    act(() => latestObserver().trigger())
    flushFrames()

    expect(scroll).not.toHaveBeenCalled()
  })

  it("does not yank a short panel on its first overflow", () => {
    render({
      turnKey: "turn-1",
      startAtEnd: true,
      scrollHeight: 300,
      clientHeight: 400,
    })
    finishInitialAlignment()
    viewport().dataset.scrollHeight = "500"

    act(() => latestObserver().trigger())
    flushFrames()
    expect(scroll).not.toHaveBeenCalled()

    viewport().dataset.scrollHeight = "600"
    act(() => latestObserver().trigger())
    flushFrames()
    expect(scroll).toHaveBeenCalledOnce()
  })

  it("disconnects the old observer and listener on a turn switch", () => {
    const removeEventListener = vi.spyOn(
      HTMLElement.prototype,
      "removeEventListener"
    )
    render({ turnKey: "turn-1", startAtEnd: true })
    const firstObserver = latestObserver()

    render({ turnKey: "turn-2", startAtEnd: true })

    expect(firstObserver.disconnect).toHaveBeenCalledOnce()
    expect(
      removeEventListener.mock.calls.some(([type]) => type === "scroll")
    ).toBe(true)
    expect(resizeObservers).toHaveLength(2)
  })

  it("keeps a replacement viewport attached through a late old-shell cleanup", () => {
    let follower: ActivityPanelScrollFollow | undefined
    act(() => {
      root.render(
        <CaptureHarness
          onFollower={(value) => {
            follower = value
          }}
        />
      )
    })
    if (!follower) throw new Error("Missing follower")

    const oldViewport = document.createElement("div")
    oldViewport.dataset.scrollHeight = "1000"
    oldViewport.dataset.clientHeight = "400"
    const newViewport = document.createElement("div")
    newViewport.dataset.scrollHeight = "1200"
    newViewport.dataset.clientHeight = "400"

    const cleanupOld = attach(follower.viewportRef, oldViewport)
    const cleanupNew = attach(follower.viewportRef, newViewport)
    cleanupOld()
    flushFrames()

    expect(scroll).toHaveBeenCalledOnce()
    expect(scroll.mock.instances[0]).toBe(newViewport)
    cleanupNew()
  })

  it("cancels a pending alignment on unmount", () => {
    render({ turnKey: "turn-1", startAtEnd: true })

    act(() => root.unmount())
    flushFrames()

    expect(cancelAnimationFrame).toHaveBeenCalledOnce()
    expect(scroll).not.toHaveBeenCalled()
    root = createRoot(container)
  })

  it("leaves a historical initial mount at the top", () => {
    render({ turnKey: "historical", startAtEnd: false })

    flushFrames()

    expect(viewport().scrollTop).toBe(0)
    expect(scroll).not.toHaveBeenCalled()
  })
})
