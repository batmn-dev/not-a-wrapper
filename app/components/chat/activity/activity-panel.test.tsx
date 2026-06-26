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

// --- matchMedia / viewport mock (first in this suite; useBreakpoint reads
// window.innerWidth and listens for matchMedia "change"). ---
const mqlListeners = new Set<() => void>()

function setViewport(belowLg: boolean) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: belowLg ? 800 : 1280,
  })
}

function installMatchMedia() {
  window.matchMedia = ((query: string) => ({
    matches: window.innerWidth < 1024,
    media: query,
    onchange: null,
    addEventListener: (_type: string, cb: () => void) => {
      mqlListeners.add(cb)
    },
    removeEventListener: (_type: string, cb: () => void) => {
      mqlListeners.delete(cb)
    },
    addListener: (cb: () => void) => {
      mqlListeners.add(cb)
    },
    removeListener: (cb: () => void) => {
      mqlListeners.delete(cb)
    },
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

describe("ActivityPanel coexistence (R5/R6/R9)", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    mqlListeners.clear()
    setViewport(false)
    installMatchMedia()
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

  function render(open: boolean, props = panelProps(5)) {
    act(() => {
      root?.render(
        <ActivityPanelHostProvider>
          <ActivityPanelDockSlot />
          <ActivityPanel open={open} onOpenChange={() => {}} {...props} />
        </ActivityPanelHostProvider>
      )
    })
  }

  function fireResize(belowLg: boolean) {
    setViewport(belowLg)
    act(() => {
      mqlListeners.forEach((cb) => cb())
    })
  }

  const landmarks = () =>
    document.querySelectorAll('[aria-label="Reasoning details"]')
  const sheets = () => document.querySelectorAll('[data-slot="sheet-content"]')
  const imgs = () => document.querySelectorAll("img")

  it("≥lg open: one docked landmark, N favicons, no sheet dialog", () => {
    setViewport(false)
    render(true)

    expect(landmarks()).toHaveLength(1)
    expect(sheets()).toHaveLength(0)
    expect(imgs()).toHaveLength(5)
  })

  it("<lg open: the sheet owns the body (N favicons), no docked landmark", () => {
    setViewport(true)
    render(true)

    expect(sheets()).toHaveLength(1)
    expect(landmarks()).toHaveLength(0)
    expect(imgs()).toHaveLength(5)
  })

  it("resize across lg keeps the body in exactly one shell (favicons == N, not 2N)", () => {
    setViewport(false)
    render(true)
    expect(landmarks()).toHaveLength(1)
    expect(sheets()).toHaveLength(0)
    expect(imgs()).toHaveLength(5)

    fireResize(true)
    expect(landmarks()).toHaveLength(0)
    expect(sheets()).toHaveLength(1)
    expect(imgs()).toHaveLength(5)

    fireResize(false)
    expect(landmarks()).toHaveLength(1)
    expect(sheets()).toHaveLength(0)
    expect(imgs()).toHaveLength(5)
  })

  it("closed panel mounts no body (≥lg): no landmark, no favicons", () => {
    setViewport(false)
    render(false)

    expect(landmarks()).toHaveLength(0)
    expect(sheets()).toHaveLength(0)
    expect(imgs()).toHaveLength(0)
  })

  it("reopens after close: open → close → open re-mounts the docked body", () => {
    setViewport(false)
    render(true)
    expect(landmarks()).toHaveLength(1)

    render(false)
    expect(landmarks()).toHaveLength(0)
    expect(imgs()).toHaveLength(0)

    render(true)
    expect(landmarks()).toHaveLength(1)
    expect(imgs()).toHaveLength(5)
  })

  it("the sheet carries motion-reduce-gated transitions (R7)", () => {
    setViewport(true)
    render(true)
    const sheet = document.querySelector('[data-slot="sheet-content"]')
    expect(sheet).toBeTruthy()
    expect(sheet!.getAttribute("class")).toContain("motion-reduce:transition-none")
  })
})
