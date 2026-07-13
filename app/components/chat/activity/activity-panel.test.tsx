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
import { activityEntryMarker, ActivityPanel } from "./activity-panel"
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
    // Three visible search chips plus all five result rows.
    expect(document.querySelectorAll("img")).toHaveLength(8)
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
      'section[aria-label="Reasoning details"] > div'
    )
    expect(header?.className).toContain("spacing-app-header")
    expect(header?.className).toContain("sharp-edge-top-shadow")
    expect(header?.className).not.toContain("sharp-edge-left-shadow")
    expect(header?.hasAttribute("data-scrolled")).toBe(false)

    const shell = document.querySelector<HTMLElement>(
      'section[aria-label="Reasoning details"]'
    )
    expect(shell?.className).not.toContain("sharp-edge-left-shadow")
    expect(shell?.className).toContain("border-s")

    const closeButton = shell?.querySelector('button[aria-label="Close"]')
    expect(closeButton?.getAttribute("aria-expanded")).toBeNull()
    expect(closeButton?.getAttribute("aria-controls")).toBeNull()
  })

  it("propagates timeline position through the entry wrapper", () => {
    act(() => {
      root?.render(
        <ActivityPanelHostProvider>
          <ActivityPanelDockSlot />
          <ActivityPanel open onOpenChange={() => {}} {...panelProps(5)} />
        </ActivityPanelHostProvider>
      )
    })

    const steps = Array.from(
      document.querySelectorAll<HTMLElement>("[data-activity-step]")
    )
    expect(steps.map((step) => step.getAttribute("data-last"))).toEqual([
      "false",
      "true",
    ])
    expect(steps.map((step) => step.style.zIndex)).toEqual(["1", "2"])
  })

  it("expands N more sources inline with disclosure semantics and resets on reopen", () => {
    function Harness({ open }: { open: boolean }) {
      return (
        <ActivityPanelHostProvider>
          <ActivityPanelDockSlot />
          <ActivityPanel
            open={open}
            onOpenChange={() => {}}
            {...panelProps(5)}
          />
        </ActivityPanelHostProvider>
      )
    }

    act(() => root?.render(<Harness open />))
    const more = document.querySelector<HTMLButtonElement>(
      'button[aria-expanded="false"]'
    )
    expect(more?.textContent).toBe("2 more")
    expect(more?.getAttribute("aria-controls")).toBeTruthy()
    expect(document.querySelectorAll("img")).toHaveLength(8)

    act(() => more?.click())
    expect(document.body.textContent).not.toContain("2 more")
    // Five inline chips plus five Sources gallery rows.
    expect(document.querySelectorAll("img")).toHaveLength(10)

    act(() => root?.render(<Harness open={false} />))
    act(() => root?.render(<Harness open />))
    expect(
      document.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')
        ?.textContent
    ).toBe("2 more")
  })

  it("maps chosen marker glyphs over the closed entry algebra", () => {
    // Exhaustiveness and illegal kind×status pairs are compiler-enforced by
    // the closed entry variants; this pins only the chosen glyph per legal
    // shape (status marker beats kind marker; denied collapses to error).
    const python = { toolName: "python", displayName: "Python" }
    expect(
      activityEntryMarker({
        id: "r",
        kind: "reasoning",
        title: "t",
        status: "complete",
      })
    ).toBe("reasoning")
    expect(
      activityEntryMarker({
        id: "s",
        kind: "search",
        title: "t",
        status: "running",
        sources: [],
      })
    ).toBe("search")
    expect(
      activityEntryMarker({
        id: "t",
        kind: "tool",
        title: "t",
        status: "denied",
        tool: python,
      })
    ).toBe("error")
    expect(
      activityEntryMarker({
        id: "t",
        kind: "tool",
        title: "t",
        status: "approval",
        tool: { ...python, approvalId: "a1" },
      })
    ).toBe("approval")
    expect(
      activityEntryMarker({
        id: "completion",
        kind: "completion",
        title: "Worked for 5s",
        detail: "Done",
        status: "complete",
      })
    ).toBe("completedRun")
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
})
