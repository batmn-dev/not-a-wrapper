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
import { ActivityPanelTrigger } from "./activity-panel-trigger"

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true
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

  it("is a focusable button named 'Open activity' that shows the summary and fires onOpen", () => {
    const onOpen = vi.fn()
    act(() => {
      root?.render(<ActivityPanelTrigger onOpen={onOpen} summary="3 sources" />)
    })

    const button = container!.querySelector("button")
    expect(button).toBeTruthy()
    expect(button!.tagName).toBe("BUTTON")
    expect(button!.getAttribute("aria-label")).toBe("Open activity")
    expect(container!.textContent).toContain("3 sources")

    act(() => {
      button!.click()
    })
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it("defaults the summary to 'Activity'", () => {
    act(() => {
      root?.render(<ActivityPanelTrigger onOpen={() => {}} />)
    })
    expect(container!.textContent).toContain("Activity")
  })
})
