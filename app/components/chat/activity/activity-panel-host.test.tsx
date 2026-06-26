/** @vitest-environment jsdom */
import React, { act } from "react"
import { createPortal } from "react-dom"
import { createRoot, type Root } from "react-dom/client"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest"
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
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true
})

describe("ActivityPanel host (R4/R6)", () => {
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
          <div className="flex">
            <div data-testid="column">scroll column</div>
            <ActivityPanelDockSlot />
          </div>
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
    expect(slot).toBeTruthy()
    expect(slot!.querySelector('[data-testid="docked"]')).toBeTruthy()

    // Unmount the panel (Probe) — the slot must not retain stale DOM.
    render(false)
    expect(
      slot!.querySelector('[data-testid="docked"]')
    ).toBeNull()
  })

  it("keeps the dock slot a flex sibling of the scroll column (R4 seam)", () => {
    render(false)
    const slot = container!.querySelector('[data-slot="activity-panel-dock"]')
    const column = container!.querySelector('[data-testid="column"]')
    expect(slot && column).toBeTruthy()
    // Same parent → sibling track; the panel never wraps/owns the scroll column.
    expect(slot!.parentElement).toBe(column!.parentElement)
  })

  it("collapses to w-0 when empty and expands only when populated (motion-reduce gated)", () => {
    render(false)
    const slot = container!.querySelector('[data-slot="activity-panel-dock"]')!
    const cls = slot.getAttribute("class") ?? ""
    expect(cls).toContain("w-0")
    expect(cls).toContain("[&:not(:empty)]:w-[var(--activity-panel-width)]")
    expect(cls).toContain("motion-reduce:transition-none")
  })
})
