/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Header } from "./header"

vi.mock("@/app/auth/_components/auth-modal", () => ({
  AuthModalTrigger: ({ children }: { children: React.ReactNode }) => (
    <button>{children}</button>
  ),
}))

vi.mock("@/app/components/history/history-trigger", () => ({
  HistoryTrigger: () => <button>History</button>,
}))

vi.mock("@/app/components/layout/button-new-chat", () => ({
  ButtonNewChat: () => <button>New chat</button>,
}))

vi.mock("@/app/components/layout/user-menu", () => ({
  UserMenu: () => <button>User menu</button>,
}))

vi.mock("@/components/icons/naw", () => ({
  NawIcon: () => <svg aria-hidden="true" />,
}))

vi.mock("@/hooks/use-breakpoint", () => ({
  useBreakpoint: () => false,
}))

vi.mock("@/lib/user-store/provider", () => ({
  useUser: () => ({ user: { id: "user-1" } }),
}))

vi.mock("./dialog-publish", () => ({
  DialogPublish: () => <button>Share</button>,
}))

vi.mock("./header-sidebar-trigger", () => ({
  HeaderSidebarTrigger: () => <button>Sidebar</button>,
}))

describe("Header", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("keeps onboarding headers in the scroll root safe-area calculation", () => {
    act(() => root.render(<Header hasSidebar fixedHeader="always" />))

    const header = container.querySelector("#page-header")
    expect(header?.getAttribute("data-fixed-header")).toBe("always")
    expect(header?.className).toContain("h-header-height")
    expect(header?.className).toContain("sticky")
  })

  it("supports transparent headers outside the chat route contract", () => {
    act(() => root.render(<Header hasSidebar fixedHeader="never" />))

    expect(
      container.querySelector("#page-header")?.getAttribute("data-fixed-header")
    ).toBe("never")
  })
})
