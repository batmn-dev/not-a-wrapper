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
              {
                id: "completion",
                kind: "completion" as const,
                title: "Worked for 5s",
                detail: "Done",
                status: "complete" as const,
              },
            ] as const,
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
                {
                  id: "completion",
                  kind: "completion",
                  title: "Worked for 5s",
                  detail: "Done",
                  status: "complete",
                },
              ],
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

  it("uses one exhaustive semantic marker mapping", () => {
    const marker = (
      kind: "reasoning" | "search" | "tool" | "image" | "completion",
      status:
        "running" | "complete" | "approval" | "error" | "denied" | "stopped"
    ) =>
      activityEntryMarker({
        id: `${kind}-${status}`,
        kind,
        status,
        title: "Marker",
      })

    expect(marker("reasoning", "running")).toBe("reasoning")
    expect(marker("reasoning", "complete")).toBe("reasoning")
    expect(marker("search", "complete")).toBe("search")
    expect(marker("tool", "running")).toBe("code")
    expect(marker("tool", "approval")).toBe("approval")
    expect(marker("completion", "complete")).toBe("completedRun")
    expect(marker("tool", "error")).toBe("error")
    expect(marker("tool", "denied")).toBe("error")
    expect(marker("tool", "stopped")).toBe("stopped")
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

  it("copies normalized tool code and exposes temporary completion feedback", () => {
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
      act(() => copyButton?.click())
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
})
