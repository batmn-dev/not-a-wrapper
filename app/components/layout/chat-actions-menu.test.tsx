/** @vitest-environment jsdom */
import type { Chat } from "@/lib/chat-store/types"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { ChatActionsMenu } from "./chat-actions-menu"
import type { RowActionItem } from "./row-actions-menu"

vi.mock("@/lib/chat-store/messages/provider", () => ({
  useResetMessages: () => vi.fn(),
}))
vi.mock("@/lib/chat-store/chats/provider", () => ({
  useChats: () => ({
    deleteChat: vi.fn(),
    togglePinned: vi.fn(),
    updateTitle: vi.fn(),
  }),
}))
vi.mock("@/lib/chat-store/session/provider", () => ({
  useChatSession: () => ({ chatId: "active-chat" }),
}))
vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock("./share-publish-drawer", () => ({ SharePublishDrawer: () => null }))
vi.mock("./row-actions-menu", () => ({
  RowActionsMenu: ({ items }: { items: RowActionItem[] }) => (
    <button onClick={items.find((item) => item.key === "delete")?.onSelect}>
      Request delete
    </button>
  ),
}))
vi.mock("./sidebar/dialog-delete-chat", () => ({
  DialogDeleteChat: ({
    isOpen,
    setIsOpen,
  }: {
    isOpen: boolean
    setIsOpen: (open: boolean) => void
  }) => (
    <div data-delete-dialog data-open={isOpen}>
      <button onClick={() => setIsOpen(false)}>Cancel</button>
    </div>
  ),
}))

it("mounts the delete dialog on first request and retains it while closing", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  const chat: Chat = {
    id: "active-chat",
    user_id: "owner",
    title: "Test chat",
    model: null,
    project_id: null,
    public: false,
    pinned: false,
    pinned_at: null,
    created_at: null,
    updated_at: null,
  }
  try {
    act(() => root.render(<ChatActionsMenu chat={chat} />))
    expect(container.querySelector("[data-delete-dialog]")).toBeNull()
    act(() => container.querySelector("button")!.click())
    const dialog = container.querySelector("[data-delete-dialog]")!
    expect(dialog.getAttribute("data-open")).toBe("true")
    act(() => dialog.querySelector("button")!.click())
    expect(container.querySelector("[data-delete-dialog]")).toBe(dialog)
    expect(dialog.getAttribute("data-open")).toBe("false")
  } finally {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  }
})
