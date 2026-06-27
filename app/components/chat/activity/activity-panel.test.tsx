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
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true
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
    expect(document.getElementById(titleId ?? "")?.textContent).toBe(
      "Activity"
    )
    expect(regions[0]?.getAttribute("aria-label")).toBeNull()
    expect(
      document.querySelectorAll('[data-slot="sheet-content"]')
    ).toHaveLength(0)
    expect(document.querySelectorAll("img")).toHaveLength(5)
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

    expect(document.body.textContent).toContain("Pro thinking")
    expect(document.body.textContent).toContain("Reasoning")
    expect(document.body.textContent).toContain("Activity")
  })
})
