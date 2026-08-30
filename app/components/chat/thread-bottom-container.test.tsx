/** @vitest-environment jsdom */

import { ScrollRoot } from "@/components/ui/scroll-root"
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
import { ThreadBottomContainer } from "./thread-bottom-container"

describe("ThreadBottomContainer", () => {
  let container: HTMLDivElement
  let root: Root
  let scrollTo: ReturnType<typeof vi.fn>
  let originalScrollTo: PropertyDescriptor | undefined

  beforeAll(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  beforeEach(() => {
    originalScrollTo = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollTo"
    )
    scrollTo = vi.fn()
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollTo,
    })
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root.render(
        <ScrollRoot>
          <ThreadBottomContainer>
            <div data-testid="composer" />
          </ThreadBottomContainer>
        </ScrollRoot>
      )
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    if (originalScrollTo) {
      Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo)
    } else {
      delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo
    }
    vi.restoreAllMocks()
  })

  it("renders the stable footer regions", () => {
    const footer = container.querySelector("#thread-bottom-container")

    expect(footer?.children).toHaveLength(4)
    expect(
      footer?.children[0].hasAttribute("data-thread-footer-overflow-spacer")
    ).toBe(true)
    expect(
      footer?.children[1].hasAttribute("data-thread-above-composer")
    ).toBe(true)
    expect(
      footer?.children[1].querySelector("[data-thread-above-composer-slot]")
    ).not.toBeNull()
    expect(
      footer?.children[2].hasAttribute("data-thread-scroll-control-layer")
    ).toBe(true)
    expect(footer?.children[3].id).toBe("thread-bottom")
    expect(
      footer?.children[3].querySelector("[data-thread-bottom-content]")
    ).not.toBeNull()
    expect(
      footer?.querySelector(
        "[data-thread-composer-column] [data-composer-keyboard-pin] [data-keyboard-open-mask]"
      )
    ).not.toBeNull()
    expect(
      container.querySelector("[data-thread-scroll-control-visibility]")
    ).not.toBeNull()
  })

  it("preserves composer DOM identity when keyboard positioning activates", () => {
    const composer = container.querySelector('[data-testid="composer"]')

    try {
      document.documentElement.classList.add("keyboard-open")
      expect(container.querySelector('[data-testid="composer"]')).toBe(composer)
    } finally {
      document.documentElement.classList.remove("keyboard-open")
    }
    expect(container.querySelector('[data-testid="composer"]')).toBe(composer)
  })

  it("preserves composer DOM identity while resolved surface posture changes", () => {
    const composer = container.querySelector('[data-testid="composer"]')

    act(() => {
      root.render(
        <ScrollRoot>
          <ThreadBottomContainer surface="home-onboarding">
            <div data-testid="composer" />
          </ThreadBottomContainer>
        </ScrollRoot>
      )
    })
    expect(container.querySelector('[data-testid="composer"]')).toBe(composer)
    expect(container.querySelector("[data-thread-scroll-control]")).toBeNull()

    act(() => {
      root.render(
        <ScrollRoot>
          <ThreadBottomContainer surface="project-onboarding">
            <div data-testid="composer" />
          </ThreadBottomContainer>
        </ScrollRoot>
      )
    })
    expect(container.querySelector('[data-testid="composer"]')).toBe(composer)
    expect(container.querySelector("[data-thread-scroll-control]")).toBeNull()
  })

  it("keeps the existing smooth scroll-to-bottom contract", () => {
    const button = container.querySelector(
      '[data-testid="scroll-to-bottom-button"]'
    ) as HTMLButtonElement

    act(() => button.click())

    expect(scrollTo).toHaveBeenCalledWith({
      top: 0,
      behavior: "smooth",
    })
  })

  it("renders both scroll-button states", () => {
    const button = container.querySelector(
      '[data-testid="scroll-to-bottom-button"]'
    )

    expect(button?.querySelector("[data-scroll-button-arrow]")).not.toBeNull()
    expect(button?.querySelector("[data-scroll-button-wave]")).not.toBeNull()
  })
})
