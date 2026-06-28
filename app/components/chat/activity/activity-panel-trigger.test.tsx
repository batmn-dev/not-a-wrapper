/** @vitest-environment jsdom */
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
import {
  ActivityPanelTrigger,
  activityStateLabel,
} from "./activity-panel-trigger"

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true
})

describe("ActivityPanelTrigger", () => {
  it("composes each thinking state into label text", () => {
    expect(activityStateLabel({ status: "thinking" })).toBe("Thinking")
    expect(activityStateLabel({ status: "thought", durationSeconds: 1 })).toBe(
      "Thought for 1s"
    )
    expect(activityStateLabel({ status: "thought" })).toBe("Thought")
    expect(activityStateLabel({ status: "sources", count: 3 })).toBe("3 sources")
    expect(activityStateLabel({ status: "activity" })).toBe("Activity")
  })

  it("renders the label with a single trailing chevron and toggles on click", () => {
    let container: HTMLDivElement | null = document.createElement("div")
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    const onOpenChange = vi.fn()

    act(() => {
      root.render(
        <ActivityPanelTrigger
          open={false}
          onOpenChange={onOpenChange}
          controlsId="activity-panel"
          state={{ status: "thought", durationSeconds: 1 }}
        />
      )
    })

    expect(container.textContent).toContain("Thought for 1s")
    // The only icon is the trailing chevron — no leading sparkle.
    expect(container.querySelectorAll("svg")).toHaveLength(1)
    expect(container.querySelector("button")?.getAttribute("aria-expanded")).toBe(
      "false"
    )
    expect(container.querySelector("button")?.getAttribute("aria-controls")).toBe(
      "activity-panel"
    )

    act(() => {
      container!.querySelector("button")!.click()
    })
    expect(onOpenChange).toHaveBeenCalledWith(true)

    act(() => {
      root.render(
        <ActivityPanelTrigger
          open
          onOpenChange={onOpenChange}
          controlsId="activity-panel"
          state={{ status: "thought", durationSeconds: 1 }}
        />
      )
    })
    expect(
      container.querySelector("button")?.getAttribute("aria-label")
    ).toBe("Close activity: Thought for 1s")
    expect(container.querySelector("button")?.getAttribute("aria-expanded")).toBe(
      "true"
    )

    act(() => {
      container!.querySelector("button")!.click()
    })
    expect(onOpenChange).toHaveBeenLastCalledWith(false)

    act(() => {
      root.unmount()
    })
    container.remove()
    container = null
  })
})
