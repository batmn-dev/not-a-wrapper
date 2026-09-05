/** @vitest-environment jsdom */
import type { Chat } from "@/lib/chat-store/types"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeEach, expect, it, vi } from "vitest"
import { ChatActionsMenu } from "./chat-actions-menu"
import type { RowActionItem } from "./row-actions-menu"

const mocks = vi.hoisted(() => ({
  chatId: "active-chat",
  reset: vi.fn(),
  deleteChat: vi.fn(
    async (_id: string, _currentId?: string, _redirect?: () => void) => true
  ),
  togglePinned: vi.fn(),
  updateTitle: vi.fn(),
  menuRender: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.chatId = "active-chat"
  mocks.reset = vi.fn()
})

vi.mock("@/lib/chat-store/messages/provider", () => ({
  useResetMessages: () => mocks.reset,
}))
vi.mock("@/lib/chat-store/chats/provider", () => ({
  useChatActions: () => ({
    deleteChat: mocks.deleteChat,
    togglePinned: mocks.togglePinned,
    updateTitle: mocks.updateTitle,
  }),
}))
vi.mock("@/lib/chat-store/session/provider", () => ({
  useChatSession: () => ({ chatId: mocks.chatId }),
}))
vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock("./share-publish-drawer", () => ({ SharePublishDrawer: () => null }))
vi.mock("./row-actions-menu", () => ({
  RowActionsMenu: ({ items }: { items: RowActionItem[] }) => {
    mocks.menuRender()
    return (
      <button onClick={items.find((item) => item.key === "delete")?.onSelect}>
        Request delete
      </button>
    )
  },
}))
vi.mock("./sidebar/dialog-delete-chat", () => ({
  DialogDeleteChat: ({
    isOpen,
    setIsOpen,
    onConfirmDelete,
  }: {
    isOpen: boolean
    setIsOpen: (open: boolean) => void
    onConfirmDelete: () => Promise<void>
  }) => (
    <div data-delete-dialog data-open={isOpen}>
      <button onClick={() => setIsOpen(false)}>Cancel</button>
      <button data-confirm onClick={() => void onConfirmDelete()}>
        Confirm
      </button>
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

it("skips unrelated chat switches and preserves current-chat deletion scope", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const container = document.createElement("div")
  const root = createRoot(container)
  const chat: Chat = {
    id: "menu-chat",
    user_id: "owner",
    title: "Test",
    model: null,
    project_id: null,
    public: false,
    pinned: false,
    pinned_at: null,
    created_at: null,
    updated_at: null,
  }
  const render = () =>
    act(() => root.render(<ChatActionsMenu chat={{ ...chat }} />))
  try {
    mocks.chatId = "other-chat"
    render()
    expect(mocks.menuRender).toHaveBeenCalledTimes(1)
    mocks.chatId = "another-chat"
    mocks.reset = vi.fn()
    render()
    expect(mocks.menuRender).toHaveBeenCalledTimes(1)
    act(() => container.querySelector("button")!.click())
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-confirm]")!.click()
    )
    expect(mocks.deleteChat).toHaveBeenLastCalledWith(
      "menu-chat",
      undefined,
      expect.any(Function)
    )
    expect(mocks.reset).not.toHaveBeenCalled()

    mocks.chatId = "menu-chat"
    render()
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-confirm]")!.click()
    )
    expect(mocks.deleteChat).toHaveBeenLastCalledWith(
      "menu-chat",
      "menu-chat",
      expect.any(Function)
    )
    expect(mocks.reset).toHaveBeenCalledOnce()
  } finally {
    act(() => root.unmount())
    vi.unstubAllGlobals()
  }
})
