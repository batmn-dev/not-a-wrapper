/** @vitest-environment jsdom */
import type { SourceUrlUIPart, ToolUIPart } from "ai"
import React, { act } from "react"
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
import { ActivityPanel } from "./activity-panel"
import {
  ActivityPanelDockSlot,
  ActivityPanelHostProvider,
} from "./activity-panel-host"

// useBreakpoint reads window.innerWidth + window.matchMedia; stub a desktop
// (≥lg) viewport so the docked shell is the active one.
function stubDesktopViewport() {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: 1280,
  })
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

function panelProps(sourceCount: number) {
  const sources = Array.from({ length: sourceCount }, (_, i) => ({
    type: "source-url",
    sourceId: `s${i}`,
    url: `https://example${i}.com/page`,
    title: `Source ${i}`,
  })) as unknown as SourceUrlUIPart[]

  return {
    title: "Activity",
    phase: "complete" as const,
    durationSeconds: 5,
    steps: [] as ToolUIPart[],
    sources,
    reasoningText: "",
    isReasoningStreaming: false,
    isOpaqueReasoning: false,
  }
}

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

describe("ActivityPanel coexistence (R6)", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    stubDesktopViewport()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    const rootToUnmount = root
    if (rootToUnmount) {
      act(() => {
        rootToUnmount.unmount()
      })
    }
    container?.remove()
    root = null
    container = null
  })

  it("renders the body into exactly one shell at ≥lg — one landmark, favicons == N, no sheet", () => {
    act(() => {
      root?.render(
        <ActivityPanelHostProvider>
          <ActivityPanelDockSlot />
          <ActivityPanel open onOpenChange={() => {}} {...panelProps(5)} />
        </ActivityPanelHostProvider>
      )
    })

    const regions = document.querySelectorAll("section[aria-labelledby]")
    expect(regions).toHaveLength(1)

    const titleId = regions[0]?.getAttribute("aria-labelledby")
    expect(titleId).toBeTruthy()
    expect(document.getElementById(titleId ?? "")?.textContent).toBe("Activity")
    expect(regions[0]?.getAttribute("aria-label")).toBeNull()
    expect(
      document.querySelectorAll('[data-slot="sheet-content"]')
    ).toHaveLength(0)
    expect(
      document.querySelectorAll('[data-testid="stage-thread-flyout"]')
    ).toHaveLength(1)
    expect(
      document.querySelectorAll('[data-testid="screen-threadFlyOut"]')
    ).toHaveLength(1)
    expect(
      document.querySelectorAll('[data-testid="close-button"]')
    ).toHaveLength(1)
    expect(document.querySelectorAll("img")).toHaveLength(5)
  })

  it("collapses the slot on close but keeps the shell mounted until the width transition ends", () => {
    function Harness({ open }: { open: boolean }) {
      return (
        <ActivityPanelHostProvider>
          <ActivityPanelDockSlot />
          <ActivityPanel
            open={open}
            onOpenChange={() => {}}
            {...panelProps(2)}
          />
        </ActivityPanelHostProvider>
      )
    }

    act(() => {
      root?.render(<Harness open />)
    })
    const slot = document.querySelector<HTMLElement>(
      '[data-slot="activity-panel-dock"]'
    )
    // Open: the persistent layout stage is expanded and the docked shell is mounted.
    const stage = document.querySelector<HTMLElement>(
      '[data-testid="stage-thread-flyout"]'
    )
    expect(stage?.getAttribute("data-state")).toBe("open")
    const openShell = document.querySelector<HTMLElement>(
      "section[aria-labelledby]"
    )
    expect(openShell).toBeTruthy()
    expect(openShell?.getAttribute("aria-hidden")).toBeNull()
    expect(openShell?.hasAttribute("inert")).toBe(false)

    // Close: the layout stage collapses but the shell stays mounted so
    // it slides shut populated instead of vanishing in one frame.
    act(() => {
      root?.render(<Harness open={false} />)
    })
    expect(stage?.getAttribute("data-state")).toBe("closed")
    const closingShell = document.querySelector<HTMLElement>(
      "section[aria-labelledby]"
    )
    expect(closingShell).toBeTruthy()
    expect(closingShell?.getAttribute("aria-hidden")).toBe("true")
    expect(closingShell?.hasAttribute("inert")).toBe(true)

    // The width transition finishing is what unmounts the shell.
    act(() => {
      stage?.dispatchEvent(
        Object.assign(new Event("transitionend", { bubbles: true }), {
          propertyName: "width",
        })
      )
    })
    expect(document.querySelectorAll("section[aria-labelledby]")).toHaveLength(
      0
    )
  })

  it("falls back if the docked close transition end is skipped", () => {
    vi.useFakeTimers()
    function Harness({ open }: { open: boolean }) {
      return (
        <ActivityPanelHostProvider>
          <ActivityPanelDockSlot />
          <ActivityPanel
            open={open}
            onOpenChange={() => {}}
            {...panelProps(2)}
          />
        </ActivityPanelHostProvider>
      )
    }

    try {
      act(() => {
        root?.render(<Harness open />)
      })
      expect(
        document.querySelectorAll('[data-testid="screen-threadFlyOut"]')
      ).toHaveLength(1)

      act(() => {
        root?.render(<Harness open={false} />)
      })
      expect(
        document.querySelectorAll('[data-testid="screen-threadFlyOut"]')
      ).toHaveLength(1)

      act(() => {
        vi.advanceTimersByTime(700)
      })
      expect(
        document.querySelectorAll('[data-testid="screen-threadFlyOut"]')
      ).toHaveLength(0)
      expect(
        document.querySelector('[data-testid="stage-thread-flyout"]')
      ).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it("renders an opaque reasoning step when reasoning text is hidden", () => {
    act(() => {
      root?.render(
        <ActivityPanelHostProvider>
          <ActivityPanelDockSlot />
          <ActivityPanel
            open
            onOpenChange={() => {}}
            {...panelProps(0)}
            isOpaqueReasoning
          />
        </ActivityPanelHostProvider>
      )
    })

    expect(document.body.textContent).toContain("Thinking")
    expect(document.body.textContent).toContain("Reasoning")
    expect(document.body.textContent).toContain("Activity")
  })

  it("renders docked header and panel sharp-edge seams immediately", () => {
    act(() => {
      root?.render(
        <ActivityPanelHostProvider>
          <ActivityPanelDockSlot />
          <ActivityPanel open onOpenChange={() => {}} {...panelProps(0)} />
        </ActivityPanelHostProvider>
      )
    })

    const header = document.querySelector<HTMLElement>(
      "section[aria-labelledby] > div"
    )
    expect(header?.className).toContain("h-app-header")
    expect(header?.className).toContain("sharp-edge-top-shadow")
    expect(header?.className).toContain("sharp-edge-left-shadow")
    expect(header?.hasAttribute("data-scrolled")).toBe(false)

    const shell = document.querySelector<HTMLElement>(
      "section[aria-labelledby]"
    )
    expect(shell?.className).toContain("sharp-edge-left-shadow")
    expect(shell?.className).not.toContain("border-s")
  })

  it("preserves source identity for duplicate URLs", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const sources = [
      {
        type: "source-url",
        sourceId: "source-a",
        url: "https://example.com/reused",
        title: "First citation title",
      },
      {
        type: "source-url",
        sourceId: "source-b",
        url: "https://example.com/reused",
        title: "Second citation title",
      },
    ] as unknown as SourceUrlUIPart[]

    try {
      act(() => {
        root?.render(
          <ActivityPanelHostProvider>
            <ActivityPanelDockSlot />
            <ActivityPanel
              open
              onOpenChange={() => {}}
              {...panelProps(0)}
              sources={sources}
            />
          </ActivityPanelHostProvider>
        )
      })

      expect(document.body.textContent).toContain("First citation title")
      expect(document.body.textContent).toContain("Second citation title")
      expect(consoleError).not.toHaveBeenCalled()
    } finally {
      consoleError.mockRestore()
    }
  })
})
