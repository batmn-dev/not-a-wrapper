/** @vitest-environment jsdom */
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeAll, describe, expect, it, vi } from "vitest"
import type { ActivityDisclosurePresentation } from "./activity-panel-trigger"
import { ActivityPanelTrigger } from "./activity-panel-trigger"

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

const presentation: ActivityDisclosurePresentation = {
  kind: "disclosure",
  label: "Thought for 1s",
  motion: "none",
  activity: {
    entries: [
      {
        id: "reasoning-0",
        kind: "reasoning",
        title: "Thinking",
        detail: "Visible reasoning",
        status: "complete",
      },
    ],
    sourceResults: [],
    imageResults: [],
  },
  durationSeconds: 1,
}

describe("ActivityPanelTrigger", () => {
  it("renders one native disclosure control and toggles on click", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    const onOpenChange = vi.fn()

    act(() => {
      root.render(
        <ActivityPanelTrigger
          open={false}
          onOpenChange={onOpenChange}
          controlsId="activity-panel"
          presentation={presentation}
        />
      )
    })

    const button = container.querySelector("button")
    expect(button?.textContent).toContain("Thought for 1s")
    expect(button?.getAttribute("aria-expanded")).toBe("false")
    expect(button?.getAttribute("aria-controls")).toBe("activity-panel")

    const statusRow = button?.querySelector(
      '[data-slot="activity-status-row"]'
    )
    const statusText = statusRow?.querySelector("span")
    const icon = button?.querySelector<HTMLElement>('[data-slot="icon"]')
    expect(button?.className).toContain("min-w-0")
    expect(button?.className).toContain("max-w-full")
    expect(statusRow?.className).toContain("h-6")
    expect(statusRow?.className).toContain("min-w-0")
    expect(statusRow?.className).toContain("max-w-full")
    expect(statusRow?.className).toContain("gap-0.5")
    expect(statusText?.className).toContain("min-w-0")
    expect(statusText?.className).toContain("flex-1")
    expect(statusText?.className).toContain("truncate")
    expect(icon?.className).toContain("text-current")
    expect(icon?.style.getPropertyValue("--icon-slot-size")).toBe("16px")
    expect(icon?.style.getPropertyValue("--icon-glyph-size")).toBe("17px")

    act(() => button?.click())
    expect(onOpenChange).toHaveBeenCalledWith(true)

    act(() => {
      root.render(
        <ActivityPanelTrigger
          open
          onOpenChange={onOpenChange}
          controlsId="activity-panel"
          presentation={presentation}
        />
      )
    })
    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Close activity: Thought for 1s"
    )

    act(() => root.unmount())
    container.remove()
  })
})
