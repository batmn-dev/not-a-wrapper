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

  it("renders the three stable direct regions and isolates pointer input", () => {
    const footer = container.querySelector("#thread-bottom-container")
    const composer = container.querySelector('[data-testid="composer"]')

    expect(footer?.children).toHaveLength(3)
    expect(
      footer?.children[0].hasAttribute("data-thread-footer-overflow-spacer")
    ).toBe(true)
    expect(
      footer?.children[1].hasAttribute("data-thread-scroll-control-layer")
    ).toBe(true)
    expect(footer?.children[2].hasAttribute("data-thread-bottom-content")).toBe(
      true
    )
    expect(footer?.classList.contains("pointer-events-none")).toBe(true)
    expect(footer?.classList.contains("print:hidden")).toBe(true)
    expect(composer?.closest("#thread-bottom")?.classList).toContain(
      "pointer-events-auto"
    )
    expect(
      container.querySelector("[data-thread-scroll-control-visibility]")
        ?.classList
    ).toContain("pointer-events-auto")
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

  it("renders both the resting arrow and streaming wave state", () => {
    const button = container.querySelector(
      '[data-testid="scroll-to-bottom-button"]'
    )

    expect(button?.classList).toContain("h-8")
    expect(button?.classList).toContain("w-8")
    expect(button?.classList).toContain(
      "group-data-stream-active/scroll-root:w-10"
    )
    expect(button?.classList).toContain("border")
    expect(button?.classList).toContain("border-border-strong")
    expect(button?.classList).toContain("bg-clip-border")
    expect(button?.querySelector("[data-scroll-button-arrow]")).not.toBeNull()
    expect(button?.querySelector("[data-scroll-button-wave]")).not.toBeNull()
  })
})
