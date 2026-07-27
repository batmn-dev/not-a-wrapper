/** @vitest-environment jsdom */
import type { SourceUrlUIPart } from "ai"
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
import {
  ActivityPanelStoreProvider,
  createActivityPanelStore,
} from "./activity-panel-store"

type FrameCallback = (time: number) => void

class ResizeObserverStub {
  disconnect = vi.fn()
  observe = vi.fn()
  unobserve = vi.fn()
}

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

function stubMobileViewport() {
  stubDesktopViewport()
  window.innerWidth = 390
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
    durationSeconds: 5,
    activity:
      sources.length > 0
        ? {
            entries: [
              {
                id: "search",
                kind: "search" as const,
                title: "Searching the web",
                status: "complete" as const,
                sources,
              },
            ] as const,
            completion: {
              id: "completion" as const,
              kind: "completion" as const,
              title: "Worked for 5s",
              detail: "Done",
              status: "complete" as const,
            },
            sourceResults: sources,
            imageResults: [],
          }
        : undefined,
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
  let frames: Map<number, FrameCallback>
  let nextFrameId: number
  let scroll: ReturnType<typeof vi.fn>
  let originalScroll: PropertyDescriptor | undefined
  let originalGetAnimations: PropertyDescriptor | undefined

  beforeEach(() => {
    stubDesktopViewport()
    frames = new Map()
    nextFrameId = 0
    scroll = vi.fn()
    originalScroll = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "scroll"
    )
    originalGetAnimations = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "getAnimations"
    )
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
    Object.defineProperty(Element.prototype, "scroll", {
      configurable: true,
      value: scroll,
    })
    Object.defineProperty(Element.prototype, "getAnimations", {
      configurable: true,
      value: () => [],
    })
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
    if (originalScroll) {
      Object.defineProperty(Element.prototype, "scroll", originalScroll)
    } else {
      Reflect.deleteProperty(Element.prototype, "scroll")
    }
    if (originalGetAnimations) {
      Object.defineProperty(
        Element.prototype,
        "getAnimations",
        originalGetAnimations
      )
    } else {
      Reflect.deleteProperty(Element.prototype, "getAnimations")
    }
    vi.unstubAllGlobals()
  })

  function flushFrames() {
    const pending = [...frames.values()]
    frames.clear()
    act(() => {
      for (const callback of pending) callback(0)
    })
  }

  it("renders the body into exactly one shell at ≥lg — one landmark, favicons == N, no sheet", () => {
    act(() => {
      root?.render(
        <ActivityPanelHostProvider>
          <ActivityPanelDockSlot />
          <ActivityPanel open onOpenChange={() => {}} {...panelProps(5)} />
        </ActivityPanelHostProvider>
      )
    })

    const regions = document.querySelectorAll(
      'section[aria-label="Reasoning details"]'
    )
    expect(regions).toHaveLength(1)
    expect(regions[0]?.getAttribute("aria-labelledby")).toBeNull()
    expect(regions[0]?.textContent).toContain("Activity")
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
    // Three visible search chips, the overflow toggle's two-favicon stack
    // (both hidden sources), plus all five result rows.
    expect(document.querySelectorAll('[data-slot="avatar"]')).toHaveLength(10)
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
      'section[aria-label="Reasoning details"]'
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
      'section[aria-label="Reasoning details"]'
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
    expect(
      document.querySelectorAll('section[aria-label="Reasoning details"]')
    ).toHaveLength(0)
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

  it("renders only a non-empty visible reasoning section", () => {
    act(() => {
      root?.render(
        <ActivityPanelHostProvider>
          <ActivityPanelDockSlot />
          <ActivityPanel
            open
            onOpenChange={() => {}}
            {...panelProps(0)}
            activity={{
              entries: [
                {
                  id: "reasoning-0",
                  kind: "reasoning",
                  title: "Reasoning",
                  detail: "Visible reasoning",
                  status: "complete",
                },
              ],
              completion: {
                id: "completion",
                kind: "completion",
                title: "Worked for 5s",
                detail: "Done",
                status: "complete",
              },
              sourceResults: [],
              imageResults: [],
            }}
          />
        </ActivityPanelHostProvider>
      )
    })

    expect(document.body.textContent).toContain("Thinking")
    expect(document.body.textContent).toContain("Reasoning")
    expect(document.body.textContent).toContain("Visible reasoning")
    expect(document.body.textContent).toContain("Activity")
  })

  it("routes running reasoning detail through the presentation reveal and drains on complete", () => {
    const renderReasoning = (detail: string, status: "running" | "complete") => {
      act(() => {
        root?.render(
          <ActivityPanelHostProvider>
            <ActivityPanelDockSlot />
            <ActivityPanel
              open
              onOpenChange={() => {}}
              {...panelProps(0)}
              activity={{
                entries: [
                  {
                    id: "reasoning-live",
                    kind: "reasoning",
                    title: "Thinking it through",
                    detail,
                    status,
                  },
                ],
                sourceResults: [],
                imageResults: [],
              }}
            />
          </ActivityPanelHostProvider>
        )
      })
    }

    // Text present at mount adopts instantly with zero reveal structure —
    // adopted words are born already-revealed and the plugin leaves elapsed
    // words as plain text.
    renderReasoning("Considering the options carefully.", "running")
    expect(document.body.textContent).toContain(
      "Considering the options carefully."
    )
    expect(document.querySelectorAll(".stream-word")).toHaveLength(0)

    // Growth after mount reveals word-by-word on frames (reasoning profile).
    renderReasoning(
      "Considering the options carefully. Weighing the tradeoffs now.",
      "running"
    )
    let frameTime = 0
    for (let i = 0; i < 30 && frames.size > 0; i++) {
      frameTime += 16
      const pending = [...frames.values()]
      frames.clear()
      const at = frameTime
      act(() => {
        for (const callback of pending) callback(at)
      })
    }
    // The trailing partial word ("now.") is held until settle; the rest of
    // the appended sentence reveals on frames, with in-flight fade spans.
    expect(document.body.textContent).toContain("Weighing the tradeoffs")
    expect(document.querySelectorAll(".stream-word").length).toBeGreaterThan(0)

    // Completion settles the entry: the reveal drains (settle phase frames
    // release the held tail) and the fade wrappers unwrap — zero spans.
    renderReasoning(
      "Considering the options carefully. Weighing the tradeoffs now.",
      "complete"
    )
    for (let i = 0; i < 30 && frames.size > 0; i++) {
      frameTime += 16
      const pending = [...frames.values()]
      frames.clear()
      const at = frameTime
      act(() => {
        for (const callback of pending) callback(at)
      })
    }
    expect(document.body.textContent).toContain("Weighing the tradeoffs now.")
    expect(document.querySelectorAll(".stream-word")).toHaveLength(0)
  })

  it("expands N more sources inline with disclosure semantics and resets on reopen", () => {
    function Harness({
      open,
      turnKey = "turn-1",
    }: {
      open: boolean
      turnKey?: string
    }) {
      return (
        <ActivityPanelHostProvider>
          <ActivityPanelDockSlot />
          <ActivityPanel
            open={open}
            onOpenChange={() => {}}
            turnKey={turnKey}
            {...panelProps(5)}
          />
        </ActivityPanelHostProvider>
      )
    }

    act(() => root?.render(<Harness open />))
    const more = document.querySelector<HTMLButtonElement>(
      'button[aria-expanded="false"]'
    )
    // Collapsed: favicon-stack preview of the hidden sources + "N more".
    expect(more?.textContent).toBe("2 more")
    expect(more?.getAttribute("aria-controls")).toBeTruthy()
    expect(more?.querySelectorAll('[data-slot="avatar"]')).toHaveLength(2)
    expect(document.querySelectorAll('[data-slot="avatar"]')).toHaveLength(10)

    act(() => more?.click())
    // Expanded: all chips inline plus a text-only "Show less" toggle.
    expect(document.body.textContent).not.toContain("2 more")
    const less = document.querySelector<HTMLButtonElement>(
      'button[aria-expanded="true"]'
    )
    expect(less?.textContent).toBe("Show less")
    expect(less?.querySelectorAll('[data-slot="avatar"]')).toHaveLength(0)
    // Five inline chips plus five Sources gallery rows.
    expect(document.querySelectorAll('[data-slot="avatar"]')).toHaveLength(10)

    // The toggle round-trips freely.
    act(() => less?.click())
    expect(
      document.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')
        ?.textContent
    ).toBe("2 more")

    act(() => less?.click())
    act(() => root?.render(<Harness open turnKey="turn-2" />))
    expect(
      document.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')
        ?.textContent
    ).toBe("2 more")

    act(() =>
      document
        .querySelector<HTMLButtonElement>('button[aria-expanded="false"]')
        ?.click()
    )
    act(() => root?.render(<Harness open={false} />))
    act(() => root?.render(<Harness open />))
    expect(
      document.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')
        ?.textContent
    ).toBe("2 more")
  })

  it("renders unsafe search sources as passive chips", () => {
    act(() => {
      root?.render(
        <ActivityPanelHostProvider>
          <ActivityPanelDockSlot />
          <ActivityPanel
            open
            onOpenChange={() => {}}
            {...panelProps(0)}
            activity={{
              entries: [
                {
                  id: "unsafe-search",
                  kind: "search",
                  title: "Searching safely",
                  status: "complete",
                  sources: [
                    {
                      type: "source-url",
                      sourceId: "unsafe",
                      url: "javascript:alert(1)",
                      title: "Unsafe",
                    },
                  ],
                },
              ],
              sourceResults: [],
              imageResults: [],
            }}
          />
        </ActivityPanelHostProvider>
      )
    })

    const group = document.querySelector('[role="group"][aria-label]')
    expect(group?.querySelector("a")).toBeNull()
    expect(group?.textContent).toContain("javascript:alert(1)")
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
              activity={{
                entries: [
                  {
                    id: "search",
                    kind: "search",
                    title: "Searching the web",
                    status: "complete",
                    sources,
                  },
                ],
                sourceResults: sources,
                imageResults: [],
              }}
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

  it("copies normalized tool code and exposes temporary completion feedback", async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    const originalClipboard = Object.getOwnPropertyDescriptor(
      navigator,
      "clipboard"
    )
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })

    try {
      act(() => {
        root?.render(
          <ActivityPanelHostProvider>
            <ActivityPanelDockSlot />
            <ActivityPanel
              open
              onOpenChange={() => {}}
              {...panelProps(0)}
              activity={{
                entries: [
                  {
                    id: "tool-copy",
                    kind: "tool",
                    title: "Checking tests",
                    status: "complete",
                    tool: {
                      toolName: "python",
                      displayName: "Python",
                      code: "python -m pytest -q",
                    },
                  },
                ],
                sourceResults: [],
                imageResults: [],
              }}
            />
          </ActivityPanelHostProvider>
        )
      })

      const copyButton = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Copy"]'
      )
      await act(async () => copyButton?.click())
      expect(writeText).toHaveBeenCalledWith("python -m pytest -q")
      expect(copyButton?.getAttribute("aria-label")).toBe("Copied")

      act(() => vi.advanceTimersByTime(1000))
      expect(copyButton?.getAttribute("aria-label")).toBe("Copy")
    } finally {
      if (originalClipboard) {
        Object.defineProperty(navigator, "clipboard", originalClipboard)
      } else {
        Reflect.deleteProperty(navigator, "clipboard")
      }
      vi.useRealTimers()
    }
  })

  it("keeps copy feedback idle when clipboard writing is unavailable or fails", async () => {
    const originalClipboard = Object.getOwnPropertyDescriptor(
      navigator,
      "clipboard"
    )

    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: undefined,
      })
      act(() => {
        root?.render(
          <ActivityPanelHostProvider>
            <ActivityPanelDockSlot />
            <ActivityPanel
              open
              onOpenChange={() => {}}
              activity={{
                entries: [
                  {
                    id: "tool-code",
                    kind: "tool",
                    title: "Ran tests",
                    status: "complete",
                    tool: {
                      toolName: "python",
                      displayName: "Python",
                      code: "python -m pytest -q",
                    },
                  },
                ],
                sourceResults: [],
                imageResults: [],
              }}
            />
          </ActivityPanelHostProvider>
        )
      })

      const copyButton = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Copy"]'
      )
      await act(async () => copyButton?.click())
      expect(copyButton?.getAttribute("aria-label")).toBe("Copy")

      const writeText = vi.fn().mockRejectedValue(new Error("denied"))
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      })
      await act(async () => copyButton?.click())
      expect(writeText).toHaveBeenCalledWith("python -m pytest -q")
      expect(copyButton?.getAttribute("aria-label")).toBe("Copy")
    } finally {
      if (originalClipboard) {
        Object.defineProperty(navigator, "clipboard", originalClipboard)
      } else {
        Reflect.deleteProperty(navigator, "clipboard")
      }
    }
  })

  it("prevents duplicate approval submissions while a request is pending", async () => {
    let settleApproval: (() => void) | undefined
    const approvalRequest = new Promise<void>((resolve) => {
      settleApproval = resolve
    })
    const onToolApproval = vi.fn(() => approvalRequest)
    const renderApproval = (handler?: typeof onToolApproval) => {
      root?.render(
        <ActivityPanelHostProvider>
          <ActivityPanelDockSlot />
          <ActivityPanel
            open
            onOpenChange={() => {}}
            onToolApproval={handler}
            activity={{
              entries: [
                {
                  id: "tool-approval",
                  kind: "tool",
                  title: "Review Python",
                  status: "approval",
                  tool: {
                    toolName: "python",
                    displayName: "Python",
                    approvalId: "approval-1",
                  },
                },
              ],
              sourceResults: [],
              imageResults: [],
            }}
          />
        </ActivityPanelHostProvider>
      )
    }

    act(() => renderApproval())
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button")
    )
    const approve = buttons.find((button) => button.textContent === "Approve")
    const deny = buttons.find((button) => button.textContent === "Deny")
    expect(approve?.disabled).toBe(true)
    expect(deny?.disabled).toBe(true)

    act(() => renderApproval(onToolApproval))
    expect(approve?.disabled).toBe(false)
    expect(deny?.disabled).toBe(false)

    act(() => {
      approve?.click()
      deny?.click()
    })
    expect(onToolApproval).toHaveBeenCalledOnce()
    expect(onToolApproval).toHaveBeenCalledWith("approval-1", true, undefined)
    expect(approve?.disabled).toBe(true)
    expect(deny?.disabled).toBe(true)

    await act(async () => {
      settleApproval?.()
      await approvalRequest
    })
    expect(approve?.disabled).toBe(false)
    expect(deny?.disabled).toBe(false)
  })

  it("attaches the live follower to the desktop viewport", () => {
    act(() => {
      root?.render(
        <ActivityPanelHostProvider>
          <ActivityPanelDockSlot />
          <ActivityPanel
            open
            onOpenChange={() => {}}
            turnKey="turn-1"
            followLatest
            {...panelProps(5)}
          />
        </ActivityPanelHostProvider>
      )
    })
    const viewport = document.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]'
    )

    flushFrames()

    expect(viewport).toBeTruthy()
    expect(scroll).toHaveBeenCalledOnce()
    expect(scroll.mock.instances[0]).toBe(viewport)
  })

  it("attaches the same live follower contract only to the mobile viewport", () => {
    stubMobileViewport()
    act(() => {
      root?.render(
        <ActivityPanelHostProvider>
          <ActivityPanelDockSlot />
          <ActivityPanel
            open
            onOpenChange={() => {}}
            turnKey="turn-1"
            followLatest
            {...panelProps(5)}
          />
        </ActivityPanelHostProvider>
      )
    })

    const viewports = document.querySelectorAll<HTMLElement>(
      '[data-slot="scroll-area-viewport"]'
    )
    flushFrames()

    expect(viewports).toHaveLength(1)
    expect(
      document.querySelectorAll('[data-slot="sheet-content"]')
    ).toHaveLength(1)
    expect(scroll).toHaveBeenCalledOnce()
    expect(scroll.mock.instances[0]).toBe(viewports[0])
  })

  it("cancels a queued live write on close and re-aligns on reopen", () => {
    function Harness({ open }: { open: boolean }) {
      return (
        <ActivityPanelHostProvider>
          <ActivityPanelDockSlot />
          <ActivityPanel
            open={open}
            onOpenChange={() => {}}
            turnKey="turn-1"
            followLatest
            {...panelProps(5)}
          />
        </ActivityPanelHostProvider>
      )
    }

    act(() => root?.render(<Harness open />))
    act(() => root?.render(<Harness open={false} />))
    flushFrames()
    expect(scroll).not.toHaveBeenCalled()

    act(() => root?.render(<Harness open />))
    flushFrames()
    expect(scroll).toHaveBeenCalledOnce()
  })

  it("keeps historical open-at-top behavior", () => {
    act(() => {
      root?.render(
        <ActivityPanelHostProvider>
          <ActivityPanelDockSlot />
          <ActivityPanel
            open
            onOpenChange={() => {}}
            turnKey="historical"
            followLatest={false}
            {...panelProps(5)}
          />
        </ActivityPanelHostProvider>
      )
    })

    flushFrames()

    expect(scroll).not.toHaveBeenCalled()
  })

  it("gives a pending Sources target priority over initial end alignment", () => {
    const store = createActivityPanelStore()
    store.setDerivedActivity({
      panelTurnId: "turn-1",
      defaultTurnId: "turn-1",
    })
    store.openTurn("turn-1", { section: "sources" })
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    })

    try {
      act(() => {
        root?.render(
          <ActivityPanelStoreProvider store={store}>
            <ActivityPanelHostProvider>
              <ActivityPanelDockSlot />
              <ActivityPanel
                open
                onOpenChange={() => {}}
                turnKey="turn-1"
                followLatest
                {...panelProps(5)}
              />
            </ActivityPanelHostProvider>
          </ActivityPanelStoreProvider>
        )
      })
      flushFrames()

      expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" })
      expect(scroll).not.toHaveBeenCalled()
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView")
    }
  })
})
