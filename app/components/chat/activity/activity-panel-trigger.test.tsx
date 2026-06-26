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
  type ActivityTriggerState,
} from "./activity-panel-trigger"

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true
})

describe("activityStateLabel (composable thinking states)", () => {
  it("composes each thinking state into text", () => {
    expect(activityStateLabel({ status: "thinking" })).toBe("Thinking")
    expect(
      activityStateLabel({ status: "thought", durationSeconds: 1 })
    ).toBe("Thought for 1s")
    expect(
      activityStateLabel({ status: "thought", durationSeconds: 75 })
    ).toBe("Thought for 1m 15s")
    expect(activityStateLabel({ status: "thought" })).toBe("Thought")
    expect(activityStateLabel({ status: "sources", count: 1 })).toBe(
      "1 source"
    )
    expect(activityStateLabel({ status: "sources", count: 3 })).toBe(
      "3 sources"
    )
    expect(activityStateLabel({ status: "activity" })).toBe("Activity")
  })
})

describe("ActivityPanelTrigger", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
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

  function render(state: ActivityTriggerState, onOpen = vi.fn()) {
    act(() => {
      root?.render(<ActivityPanelTrigger onOpen={onOpen} state={state} />)
    })
    return onOpen
  }

  it("renders the thinking-state text and a trailing chevron (no leading icon)", () => {
    render({ status: "thought", durationSeconds: 1 })

    const button = container!.querySelector("button")
    expect(button).toBeTruthy()
    expect(container!.textContent).toContain("Thought for 1s")

    // Exactly one icon (the trailing chevron) — no leading sparkle.
    const icons = container!.querySelectorAll("svg")
    expect(icons).toHaveLength(1)

    // The chevron is the LAST child of the button (rendered on the right).
    const lastChild = button!.lastElementChild
    expect(lastChild!.querySelector("svg")).toBeTruthy()
  })

  it("shows the live 'Thinking' state", () => {
    render({ status: "thinking" })
    expect(container!.textContent).toContain("Thinking")
  })

  it("names the button for activity and fires onOpen on click", () => {
    const onOpen = render({ status: "thought", durationSeconds: 1 })
    const button = container!.querySelector("button")!
    expect(button.getAttribute("aria-label")).toBe("Open activity: Thought for 1s")

    act(() => {
      button.click()
    })
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
