/** @vitest-environment jsdom */

import React, { act, useLayoutEffect, useRef } from "react"
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
import { useInfiniteScroll } from "./use-history-view"

type ScrollMetrics = {
  scrollHeight: number
  clientHeight: number
  scrollTop?: number
}

type HarnessProps = {
  canLoadMore: boolean
  metrics: ScrollMetrics
  onLoadMore: () => void
}

const originalResizeObserver = globalThis.ResizeObserver
let resizeObservers: MockResizeObserver[] = []

class MockResizeObserver implements ResizeObserver {
  private readonly callback: ResizeObserverCallback
  private readonly observed = new Set<Element>()

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    resizeObservers.push(this)
  }

  observe(target: Element) {
    this.observed.add(target)
  }

  unobserve(target: Element) {
    this.observed.delete(target)
  }

  disconnect() {
    this.observed.clear()
  }

  trigger() {
    this.callback([], this)
  }
}

function setScrollMetrics(element: HTMLElement, metrics: ScrollMetrics) {
  Object.defineProperties(element, {
    clientHeight: {
      configurable: true,
      value: metrics.clientHeight,
    },
    scrollHeight: {
      configurable: true,
      value: metrics.scrollHeight,
    },
    scrollTop: {
      configurable: true,
      value: metrics.scrollTop ?? 0,
      writable: true,
    },
  })
}

function triggerResizeObservers() {
  for (const observer of resizeObservers) {
    observer.trigger()
  }
}

function InfiniteScrollHarness({
  canLoadMore,
  metrics,
  onLoadMore,
}: HarnessProps) {
  const viewportRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (viewportRef.current) setScrollMetrics(viewportRef.current, metrics)
  }, [metrics])

  useInfiniteScroll(viewportRef, canLoadMore, onLoadMore)

  return (
    <div ref={viewportRef} data-testid="viewport">
      <div data-testid="content" />
    </div>
  )
}

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

describe("useInfiniteScroll", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    resizeObservers = []
    globalThis.ResizeObserver =
      MockResizeObserver as unknown as typeof ResizeObserver
  })

  afterEach(() => {
    const mounted = root
    if (mounted) {
      act(() => mounted.unmount())
    }
    container?.remove()
    container = null
    root = null

    if (originalResizeObserver) {
      globalThis.ResizeObserver = originalResizeObserver
    } else {
      delete (globalThis as { ResizeObserver?: typeof ResizeObserver })
        .ResizeObserver
    }
  })

  async function renderHarness(props: HarnessProps) {
    if (!container) {
      container = document.createElement("div")
      document.body.appendChild(container)
      root = createRoot(container)
    }

    await act(async () => {
      root?.render(<InfiniteScrollHarness {...props} />)
      await Promise.resolve()
    })
  }

  it("keeps loading underfilled pages until content overflows", async () => {
    const loadMore = vi.fn()

    await renderHarness({
      canLoadMore: true,
      metrics: { scrollHeight: 300, clientHeight: 500 },
      onLoadMore: loadMore,
    })
    expect(loadMore).toHaveBeenCalledTimes(1)

    await renderHarness({
      canLoadMore: true,
      metrics: { scrollHeight: 450, clientHeight: 500 },
      onLoadMore: loadMore,
    })
    act(() => triggerResizeObservers())
    expect(loadMore).toHaveBeenCalledTimes(2)

    await renderHarness({
      canLoadMore: true,
      metrics: { scrollHeight: 520, clientHeight: 500 },
      onLoadMore: loadMore,
    })
    act(() => triggerResizeObservers())
    expect(loadMore).toHaveBeenCalledTimes(2)
  })

  it("preserves scroll-based loading for later pages", async () => {
    const loadMore = vi.fn()

    await renderHarness({
      canLoadMore: true,
      metrics: { scrollHeight: 900, clientHeight: 500 },
      onLoadMore: loadMore,
    })
    expect(loadMore).not.toHaveBeenCalled()

    const viewport = container?.querySelector<HTMLDivElement>(
      "[data-testid='viewport']"
    )
    expect(viewport).not.toBeNull()

    setScrollMetrics(viewport as HTMLDivElement, {
      scrollHeight: 900,
      clientHeight: 500,
      scrollTop: 200,
    })
    act(() => {
      viewport?.dispatchEvent(new Event("scroll"))
    })

    expect(loadMore).toHaveBeenCalledTimes(1)
  })
})
