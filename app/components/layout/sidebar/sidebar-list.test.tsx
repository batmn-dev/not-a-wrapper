// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SidebarChatGroupActions } from "./sidebar-list"

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) =>
    createElement("a", props, children),
}))

vi.mock("./sidebar-item", () => ({
  SidebarItem: () => null,
}))

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("SidebarChatGroupActions", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal("ResizeObserver", ResizeObserverStub)
    vi.stubGlobal("PointerEvent", MouseEvent)
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    document.body.replaceChildren()
    vi.unstubAllGlobals()
  })

  it("exposes the controlled grouping as radio selection", async () => {
    await act(async () => {
      root.render(
        <SidebarChatGroupActions
          organization="one-list"
          onOrganizationChange={vi.fn()}
        />
      )
    })

    const trigger = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Organize chats"]'
    )
    expect(trigger).not.toBeNull()

    await act(async () => trigger?.click())

    const radioItems = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
    ]
    expect(radioItems.map((item) => item.textContent?.trim())).toEqual([
      "In one list",
      "By project",
    ])
    expect(radioItems[0]?.getAttribute("aria-checked")).toBe("true")
    expect(radioItems[1]?.getAttribute("aria-checked")).toBe("false")
  })

  it("changes grouping, closes on selection, and returns focus on Escape", async () => {
    const onOrganizationChange = vi.fn()
    await act(async () => {
      root.render(
        <SidebarChatGroupActions
          organization="by-project"
          onOrganizationChange={onOrganizationChange}
        />
      )
    })
    const trigger = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Organize chats"]'
    )

    await act(async () => trigger?.click())
    const oneList = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
    ].find((item) => item.textContent?.includes("In one list"))
    await act(async () => {
      oneList?.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 })
      )
      oneList?.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, button: 0 })
      )
      oneList?.click()
    })

    expect(onOrganizationChange).toHaveBeenCalledWith("one-list")
    expect(document.querySelector('[role="menu"]')).toBeNull()

    await act(async () => trigger?.click())
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
    })
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
