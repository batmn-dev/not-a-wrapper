/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import {
  PromptInput,
  PromptInputActions,
  PromptInputFooter,
  PromptInputTextarea,
} from "./prompt-input"

let surfaceWidth = 768
let leadingWidth = 36
let trailingWidth = 148
let scrollHeightReads = 0
let mediaMatches = false
let resizeObservers: ResizeObserverMock[] = []

function rect(width: number): DOMRect {
  return {
    bottom: 0,
    height: 0,
    left: 0,
    right: width,
    top: 0,
    width,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }
}

class ResizeObserverMock {
  readonly observe = vi.fn()
  readonly unobserve = vi.fn()
  readonly disconnect = vi.fn()

  constructor(private readonly callback: ResizeObserverCallback) {
    resizeObservers.push(this)
  }

  trigger() {
    this.callback([], this as unknown as ResizeObserver)
  }
}

describe("PromptInput responsive expansion", () => {
  let container: HTMLDivElement
  let root: Root

  beforeAll(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterAll(() => {
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT
  })

  beforeEach(() => {
    surfaceWidth = 768
    leadingWidth = 36
    trailingWidth = 148
    scrollHeightReads = 0
    mediaMatches = false
    resizeObservers = []

    vi.stubGlobal("ResizeObserver", ResizeObserverMock)
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: mediaMatches,
        media: "(max-width: 639px)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))
    )

    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function getBoundingClientRect(this: Element) {
        if (!(this instanceof HTMLElement)) return rect(0)
        if (this.dataset.composerSurface === "true") {
          return rect(surfaceWidth)
        }
        if (this.dataset.composerLeading === "true") {
          return rect(leadingWidth)
        }
        if (this.dataset.composerTrailing === "true") {
          return rect(trailingWidth)
        }
        return rect(this instanceof HTMLTextAreaElement ? 555 : 0)
      }
    )

    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      if (element instanceof HTMLTextAreaElement) {
        return {
          lineHeight: "26px",
          paddingBottom: "16px",
          paddingTop: "0px",
          getPropertyValue: () => "",
        } as unknown as CSSStyleDeclaration
      }

      return {
        paddingLeft: "8px",
        paddingRight: "8px",
        getPropertyValue: (property: string) => {
          if (property === "--composer-compact-editor-padding-start") {
            return "7px"
          }
          if (property === "--composer-compact-editor-padding-end") {
            return "6px"
          }
          return ""
        },
      } as unknown as CSSStyleDeclaration
    })

    vi.spyOn(
      HTMLTextAreaElement.prototype,
      "scrollHeight",
      "get"
    ).mockImplementation(function scrollHeight(this: HTMLTextAreaElement) {
      scrollHeightReads += 1
      const width = Number.parseFloat(this.style.width) || 555
      return this.value.length * 8 > width ? 68 : 42
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
  })

  it("remeasures a static draft when available inline width changes", () => {
    const value = "a".repeat(65)

    act(() => {
      root.render(
        <PromptInput value={value} onValueChange={() => {}}>
          <PromptInputActions data-composer-leading="true" />
          <PromptInputTextarea aria-label="Ask anything" />
          <PromptInputFooter aria-hidden="true" />
          <PromptInputActions data-composer-trailing="true" />
        </PromptInput>
      )
    })

    const form = container.querySelector("form")
    const observer = resizeObservers.at(-1)
    expect(observer).toBeTruthy()
    expect(form?.hasAttribute("data-expanded")).toBe(false)

    const readsAfterInitialLayout = scrollHeightReads
    act(() => observer?.trigger())
    expect(scrollHeightReads).toBe(readsAfterInitialLayout)

    trailingWidth = 264
    act(() => observer?.trigger())
    expect(form?.hasAttribute("data-expanded")).toBe(true)

    trailingWidth = 148
    act(() => observer?.trigger())
    expect(form?.hasAttribute("data-expanded")).toBe(false)

    surfaceWidth = 650
    act(() => observer?.trigger())
    expect(form?.hasAttribute("data-expanded")).toBe(true)

    surfaceWidth = 768
    act(() => observer?.trigger())
    expect(form?.hasAttribute("data-expanded")).toBe(false)
  })

  it("disconnects geometry observation with the textarea DOM lifecycle", () => {
    act(() => {
      root.render(
        <PromptInput value="draft" onValueChange={() => {}}>
          <PromptInputActions data-composer-leading="true" />
          <PromptInputTextarea aria-label="Ask anything" />
          <PromptInputActions data-composer-trailing="true" />
        </PromptInput>
      )
    })

    const observer = resizeObservers.at(-1)
    expect(observer).toBeTruthy()

    act(() => root.unmount())
    expect(observer?.disconnect).toHaveBeenCalledTimes(1)

    root = createRoot(container)
  })
})
