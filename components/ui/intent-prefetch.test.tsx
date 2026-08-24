/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createIntentPreloader, useIntentPrefetch } from "./intent-prefetch"

let intersectionCallback: IntersectionObserverCallback | undefined
const disconnect = vi.fn()

class IntersectionObserverMock {
  observe = vi.fn()
  disconnect = disconnect
  unobserve = vi.fn()
  takeRecords = vi.fn(() => [])
  root = null
  rootMargin = ""
  thresholds = []

  constructor(callback: IntersectionObserverCallback) {
    intersectionCallback = callback
  }
}

function Harness({ prefetch }: { prefetch: () => void | Promise<unknown> }) {
  const intentRef = useIntentPrefetch<HTMLButtonElement>(prefetch)
  return <button ref={intentRef}>Open</button>
}

describe("intent prefetch", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    disconnect.mockClear()
    intersectionCallback = undefined
    vi.stubGlobal("IntersectionObserver", IntersectionObserverMock)
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true }))
    )
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("deduplicates concurrent module loads and retries a rejected load", async () => {
    let reject: ((reason?: unknown) => void) | undefined
    const load = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, rejectPromise) => {
            reject = rejectPromise
          })
      )
      .mockResolvedValue({ loaded: true })
    const preload = createIntentPreloader(load)

    const first = preload()
    expect(preload()).toBe(first)
    expect(load).toHaveBeenCalledOnce()

    reject?.(new Error("chunk failed"))
    await first.catch(() => undefined)
    await Promise.resolve()

    await expect(preload()).resolves.toEqual({ loaded: true })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it("warms once from focus, hover, touch, or coarse-pointer visibility", () => {
    const prefetch = vi.fn()
    act(() => root.render(<Harness prefetch={prefetch} />))
    const button = container.querySelector("button") as HTMLButtonElement

    act(() => button.dispatchEvent(new FocusEvent("focus")))
    act(() => button.dispatchEvent(new PointerEvent("pointerover")))
    act(() => button.dispatchEvent(new TouchEvent("touchstart")))
    act(() =>
      intersectionCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      )
    )

    expect(prefetch).toHaveBeenCalledOnce()

    act(() => root.unmount())
    expect(disconnect).toHaveBeenCalledOnce()
    act(() => button.dispatchEvent(new FocusEvent("focus")))
    expect(prefetch).toHaveBeenCalledOnce()

    root = createRoot(container)
  })
})
