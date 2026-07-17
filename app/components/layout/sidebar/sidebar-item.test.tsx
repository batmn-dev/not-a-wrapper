// @vitest-environment jsdom

import type { Chat } from "@/lib/chat-store/types"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SidebarItem } from "./sidebar-item"

const mocks = vi.hoisted(() => ({
  isMobile: false,
  status: "idle" as "idle" | "streaming",
  setOpenMobile: vi.fn(),
}))

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) =>
    createElement("a", props, children),
}))

vi.mock("@/components/ui/sidebar", () => ({
  useSidebar: () => ({ setOpenMobile: mocks.setOpenMobile }),
}))

vi.mock("@/hooks/use-breakpoint", () => ({
  useBreakpoint: () => mocks.isMobile,
}))
vi.mock("@/hooks/use-inline-rename", () => ({
  useInlineRename: () => ({
    isEditing: false,
    start: vi.fn(),
    containerRef: { current: null },
    inputProps: {},
    onContainerClick: vi.fn(),
  }),
}))
vi.mock("@/lib/chat-store/chats/provider", () => ({
  useChats: () => ({ updateTitle: vi.fn() }),
}))
vi.mock("@/lib/chat-store/status/sidebar-chat-status", () => ({
  useSidebarChatStatus: () => mocks.status,
}))
vi.mock("./sidebar-item-menu", () => ({
  SidebarItemMenu: () => <button type="button">Actions</button>,
}))
vi.mock("./sidebar-item-status", () => ({
  SidebarChatStatusIndicator: () => <span data-status-indicator />,
}))
vi.mock("./sidebar-chat-pin-button", () => ({
  SidebarChatPinButton: () => <button type="button">Pin</button>,
}))

function chat(id: string): Chat {
  return {
    id,
    user_id: "user",
    title: "Quarterly plan",
    model: null,
    project_id: null,
    public: false,
    pinned: false,
    pinned_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
  }
}

describe("SidebarItem presentation", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    mocks.isMobile = false
    mocks.status = "idle"
    mocks.setOpenMobile.mockClear()
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it("renders the persistent pinned-chat glyph and pinned accessible name", async () => {
    await act(async () => {
      root.render(
        <SidebarItem
          chat={{ ...chat("pinned"), pinned: true }}
          currentChatId=""
          presentation={{ kind: "pinned", projectName: "Taxes" }}
        />
      )
    })

    const row = container.querySelector<HTMLAnchorElement>("a")
    const shell = row?.parentElement
    expect(row?.getAttribute("aria-label")).toBe(
      "Quarterly plan, pinned conversation in project Taxes"
    )
    expect(row?.textContent).toContain("Taxes")
    expect(row?.querySelectorAll("svg")).toHaveLength(1)
    expect(shell?.classList.contains("sidebar-row-nested")).toBe(false)
    expect(shell?.classList.contains("sidebar-menu-row")).toBe(true)
    expect(shell?.querySelector("button")).not.toBeNull()
    expect(row?.querySelector("button")).toBeNull()
    const rail = shell?.querySelector('[data-sidebar-row-actions="reflow"]')
    expect(
      rail?.querySelectorAll(":scope > .sidebar-row-action-slot")
    ).toHaveLength(2)
  })

  it("uses nested row geometry without a leading glyph or visible provenance", async () => {
    await act(async () => {
      root.render(
        <SidebarItem
          chat={{ ...chat("nested"), project_id: "project-1" }}
          currentChatId="nested"
          presentation={{ kind: "nested", projectName: "Taxes" }}
        />
      )
    })

    const row = container.querySelector<HTMLAnchorElement>("a")
    expect(row?.parentElement?.classList.contains("sidebar-row-nested")).toBe(
      true
    )
    expect(row?.getAttribute("aria-label")).toBe(
      "Quarterly plan, chat in project Taxes"
    )
    expect(row?.textContent).not.toContain("Taxes")
    expect(row?.querySelector("svg")).toBeNull()
    expect(row?.getAttribute("aria-current")).toBe("page")
  })

  it("places a non-idle status inside the centralized end-slot", async () => {
    mocks.status = "streaming"
    await act(async () => {
      root.render(<SidebarItem chat={chat("streaming")} currentChatId="" />)
    })

    const endSlot = container.querySelector(
      '[data-sidebar-row-end-slot="compact"]'
    )
    const statusSlot = endSlot?.querySelector(
      ":scope > [data-sidebar-row-status-slot]"
    )
    expect(statusSlot?.querySelector("[data-status-indicator]")).not.toBeNull()
    expect(
      endSlot?.querySelector(':scope > [data-sidebar-row-actions="reflow"]')
    ).not.toBeNull()
  })

  it("closes the mobile drawer after chat navigation", async () => {
    mocks.isMobile = true
    await act(async () => {
      root.render(
        <SidebarItem
          chat={chat("mobile")}
          currentChatId=""
          presentation={{ kind: "history" }}
        />
      )
    })

    await act(async () =>
      container.querySelector<HTMLAnchorElement>("a")?.click()
    )
    expect(mocks.setOpenMobile).toHaveBeenCalledWith(false)
  })
})
