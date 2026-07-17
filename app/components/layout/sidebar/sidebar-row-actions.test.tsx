// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { SidebarRowActions, SidebarRowEndSlot } from "./sidebar-row-actions"

describe("SidebarRowActions", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it.each(["overlay", "reflow"] as const)(
    "owns both action slots for the %s strategy",
    async (strategy) => {
      await act(async () => {
        root.render(
          <SidebarRowActions strategy={strategy}>
            <button type="button">First</button>
            <button type="button">Second</button>
          </SidebarRowActions>
        )
      })

      const rail = container.querySelector("[data-sidebar-row-actions]")
      expect(rail?.getAttribute("data-sidebar-row-actions")).toBe(strategy)
      expect(
        rail?.querySelectorAll(":scope > .sidebar-row-action-slot")
      ).toHaveLength(2)
      expect(rail?.querySelectorAll("button")).toHaveLength(2)
    }
  )

  it("composes resting status and reflow actions in the same end-slot", async () => {
    await act(async () => {
      root.render(
        <SidebarRowEndSlot status={<span>Generating</span>}>
          <button type="button">Pin</button>
          <button type="button">Menu</button>
        </SidebarRowEndSlot>
      )
    })

    const endSlot = container.querySelector(
      '[data-sidebar-row-end-slot="compact"]'
    )
    expect(
      endSlot?.querySelector(":scope > [data-sidebar-row-status-slot]")
    ).not.toBeNull()
    expect(
      endSlot?.querySelector(':scope > [data-sidebar-row-actions="reflow"]')
    ).not.toBeNull()
  })

  it("does not reserve a status slot for idle rows", async () => {
    await act(async () => {
      root.render(
        <SidebarRowEndSlot>
          <button type="button">Pin</button>
          <button type="button">Menu</button>
        </SidebarRowEndSlot>
      )
    })

    expect(container.querySelector("[data-sidebar-row-status-slot]")).toBeNull()
  })
})
