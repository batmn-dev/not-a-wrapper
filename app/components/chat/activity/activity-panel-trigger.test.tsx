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
  sections: [
    {
      kind: "reasoning",
      blocks: [{ text: "Visible reasoning" }],
      isStreaming: false,
    },
  ],
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
    expect(container.querySelectorAll("svg")).toHaveLength(1)
    expect(button?.getAttribute("aria-expanded")).toBe("false")
    expect(button?.getAttribute("aria-controls")).toBe("activity-panel")

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
