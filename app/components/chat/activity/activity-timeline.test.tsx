/** @vitest-environment jsdom */
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { ActivityStep, ActivityTimeline, StepTitle } from "./activity-timeline"

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

describe("ActivityTimeline", () => {
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

  it("injects terminal state and uses the inspected show animation on steps", () => {
    act(() => {
      root?.render(
        <ActivityTimeline>
          <ActivityStep leading="globe" body="chips">
            <StepTitle>Searching</StepTitle>
          </ActivityStep>
          <ActivityStep leading="done">
            <StepTitle>Reasoning</StepTitle>
          </ActivityStep>
        </ActivityTimeline>
      )
    })

    const steps = Array.from(
      container!.querySelectorAll<HTMLElement>("[data-last]")
    )
    expect(steps).toHaveLength(2)
    expect(steps[0]?.getAttribute("data-last")).toBe("false")
    expect(steps[1]?.getAttribute("data-last")).toBe("true")
    expect(steps[0]?.className).toContain("animate-[show_150ms_ease-in]")
  })
})
