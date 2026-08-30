/** @vitest-environment jsdom */
import React, { act } from "react"
import { createPortal } from "react-dom"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import {
  ActivityPanelDockSlot,
  ActivityPanelHostProvider,
  useActivityPanelDockSlot,
} from "./activity-panel-host"

// A Chat-like child that portals docked content into the layout slot.
function Probe() {
  const slot = useActivityPanelDockSlot()
  return slot
    ? createPortal(<div data-testid="docked">docked content</div>, slot)
    : null
}

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

describe("ActivityPanel host", () => {
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

  function render(showProbe: boolean) {
    act(() => {
      root?.render(
        <ActivityPanelHostProvider>
          <ActivityPanelDockSlot />
          {showProbe ? <Probe /> : null}
        </ActivityPanelHostProvider>
      )
    })
  }

  it("registers docked content into the slot and clears it when the panel unmounts", () => {
    render(true)
    const slot = container!.querySelector<HTMLElement>(
      '[data-slot="activity-panel-dock"]'
    )
    expect(slot?.querySelector('[data-testid="docked"]')).toBeTruthy()

    // Unmounting the panel must not leave stale panel DOM in the layout slot.
    render(false)
    expect(slot!.querySelector('[data-testid="docked"]')).toBeNull()
  })
})
