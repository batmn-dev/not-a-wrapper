// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SidebarMenuItem } from "./sidebar-menu-item"

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) =>
    createElement("a", props, children),
}))

describe("SidebarMenuItem", () => {
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

  it("renders an interactive trailing action as a sibling of the primary link", async () => {
    await act(async () => {
      root.render(
        <SidebarMenuItem
          icon={<span aria-hidden="true" />}
          label="Projects"
          href="/projects"
          trailingInteractive
          trailing={<button type="button">New project</button>}
        />
      )
    })

    const link = container.querySelector<HTMLAnchorElement>("a")
    const action = container.querySelector<HTMLButtonElement>("button")
    expect(link).not.toBeNull()
    expect(action).not.toBeNull()
    expect(link?.parentElement?.classList.contains("sidebar-menu-row")).toBe(
      true
    )
    expect(link?.parentElement?.classList.contains("sidebar-row-content")).toBe(
      true
    )
    expect(link?.contains(action)).toBe(false)
    expect(link?.parentElement).toBe(action?.parentElement?.parentElement)
  })
})
