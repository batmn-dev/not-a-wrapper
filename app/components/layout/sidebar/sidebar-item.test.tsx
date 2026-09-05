/** @vitest-environment jsdom */
import type { Chat } from "@/lib/chat-store/types"
import { act, type ComponentProps } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { SidebarItem } from "./sidebar-item"
import type { SidebarRow } from "./sidebar-row"

const mocks = vi.hoisted(() => ({
  rowRender: vi.fn(),
  updateTitle: vi.fn(),
  togglePinned: vi.fn(),
}))
vi.mock("@/lib/chat-store/chats/provider", () => ({
  useChatActions: () => mocks,
}))
vi.mock("@/lib/chat-store/messages/warm", () => ({
  useWarmSelectedConversation: () => vi.fn(),
}))
vi.mock("@/lib/chat-store/status/sidebar-chat-status", () => ({
  useSidebarChatStatus: (chat: Chat) => chat.live_run_status ?? "idle",
}))
vi.mock("@/app/components/layout/chat-actions-menu", () => ({
  ChatActionsMenu: () => null,
}))
vi.mock("./sidebar-item-status", () => ({
  SidebarChatStatusIndicator: ({ status }: { status: string }) => (
    <span data-status={status} />
  ),
}))
vi.mock("./trailing-icon-button", () => ({
  SidebarPinAction: ({
    pinned,
    onTogglePinned,
  }: {
    pinned: boolean
    onTogglePinned: () => void
  }) => (
    <button data-pin={pinned} onClick={onTogglePinned}>
      Pin
    </button>
  ),
}))
vi.mock("./sidebar-row", () => ({
  SidebarRow: ({
    title,
    isActive,
    secondaryLabel,
    onRename,
    trailing,
  }: ComponentProps<typeof SidebarRow>) => {
    mocks.rowRender()
    return (
      <div
        data-row
        data-title={title}
        data-active={isActive}
        data-secondary={secondaryLabel}
      >
        <button data-rename onClick={() => void onRename("Saved title")}>
          Rename
        </button>
        {trailing?.({ startRename: () => {} })}
      </div>
    )
  },
}))

it("skips equal inactive rows while preserving selection, chat fields, presentation, and actions", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const container = document.createElement("div")
  const root = createRoot(container)
  let chat: Chat = {
    id: "row-chat",
    user_id: "owner",
    title: "Original",
    model: null,
    project_id: null,
    public: false,
    pinned: false,
    pinned_at: null,
    created_at: null,
    updated_at: null,
  }
  const render = (
    currentChatId: string,
    presentation?: ComponentProps<typeof SidebarItem>["presentation"]
  ) =>
    act(() =>
      root.render(
        <SidebarItem
          chat={{ ...chat }}
          currentChatId={currentChatId}
          presentation={presentation}
        />
      )
    )
  try {
    render("other-chat")
    render("another-chat", { kind: "history" })
    expect(mocks.rowRender).toHaveBeenCalledTimes(1)
    render("row-chat")
    expect(mocks.rowRender).toHaveBeenCalledTimes(2)
    expect(
      container.querySelector("[data-row]")?.getAttribute("data-active")
    ).toBe("true")
    chat = {
      ...chat,
      title: "Renamed",
      pinned: true,
      live_run_status: "streaming",
    }
    render("row-chat")
    expect(mocks.rowRender).toHaveBeenCalledTimes(3)
    expect(
      container.querySelector("[data-row]")?.getAttribute("data-title")
    ).toBe("Renamed")
    expect(
      container.querySelector("[data-pin]")?.getAttribute("data-pin")
    ).toBe("true")
    expect(
      container.querySelector("[data-status]")?.getAttribute("data-status")
    ).toBe("streaming")
    chat = { ...chat, last_read_at: 123 }
    render("row-chat")
    expect(mocks.rowRender).toHaveBeenCalledTimes(4)
    render("row-chat", { kind: "pinned", projectName: "Project" })
    expect(
      container.querySelector("[data-row]")?.getAttribute("data-secondary")
    ).toBe("Project")
    expect(mocks.rowRender).toHaveBeenCalledTimes(5)
    act(() =>
      container.querySelector<HTMLButtonElement>("[data-rename]")!.click()
    )
    act(() => container.querySelector<HTMLButtonElement>("[data-pin]")!.click())
    expect(mocks.updateTitle).toHaveBeenLastCalledWith(
      "row-chat",
      "Saved title"
    )
    expect(mocks.togglePinned).toHaveBeenLastCalledWith("row-chat", false)
  } finally {
    act(() => root.unmount())
    vi.unstubAllGlobals()
  }
})
