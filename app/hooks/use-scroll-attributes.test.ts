/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  connectScrollAttributeFallback,
  supportsScrollStateQueries,
} from "./use-scroll-attributes"

class ResizeObserverMock {
  static instances: ResizeObserverMock[] = []
  readonly callback: ResizeObserverCallback
  disconnect = vi.fn()
  observe = vi.fn()

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    ResizeObserverMock.instances.push(this)
  }

  unobserve() {}
}

describe("scroll-state compatibility", () => {
  beforeEach(() => {
    ResizeObserverMock.instances = []
    vi.stubGlobal("ResizeObserver", ResizeObserverMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  it("uses native CSS scroll-state without installing a scroll listener", () => {
    const supports = vi.fn(() => true)
    vi.stubGlobal("CSS", { supports })
    const element = document.createElement("div")
    const addEventListener = vi.spyOn(element, "addEventListener")

    const cleanup = connectScrollAttributeFallback(element)

    expect(supportsScrollStateQueries()).toBe(true)
    expect(supports).toHaveBeenCalledWith("container-type: scroll-state")
    expect(addEventListener).not.toHaveBeenCalled()
    expect(ResizeObserverMock.instances).toHaveLength(0)
    cleanup()
  })

  it("preserves the data and presentation-variable fallback when unsupported", () => {
    vi.stubGlobal("CSS", { supports: () => false })
    const element = document.createElement("div")
    let scrollTop = 0
    Object.defineProperties(element, {
      clientHeight: { configurable: true, get: () => 200 },
      scrollHeight: { configurable: true, get: () => 500 },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value
        },
      },
    })

    const cleanup = connectScrollAttributeFallback(element, { threshold: 5 })

    expect(element.hasAttribute("data-scrolled-from-top")).toBe(false)
    expect(element.hasAttribute("data-scrolled-from-end")).toBe(true)
    expect(element.style.getPropertyValue("--scroll-state-top-opacity")).toBe(
      "0"
    )
    expect(
      element.style.getPropertyValue("--scroll-state-bottom-opacity")
    ).toBe("1")

    element.scrollTop = 300
    element.dispatchEvent(new Event("scroll"))

    expect(element.hasAttribute("data-scrolled-from-top")).toBe(true)
    expect(element.hasAttribute("data-scrolled-from-end")).toBe(false)
    expect(element.style.getPropertyValue("--scroll-state-top-opacity")).toBe(
      "1"
    )
    expect(
      element.style.getPropertyValue("--scroll-state-bottom-opacity")
    ).toBe("0")

    cleanup()
    expect(element.hasAttribute("data-scrolled-from-top")).toBe(false)
    expect(element.style.getPropertyValue("--scroll-state-top-opacity")).toBe(
      ""
    )
    expect(ResizeObserverMock.instances[0]?.disconnect).toHaveBeenCalledOnce()
  })
})
