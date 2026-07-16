/** @vitest-environment jsdom */

import { checkRateLimits } from "@/lib/api"
import { GUEST_CHAT_STORAGE_KEY } from "@/lib/chat-store/identity"
import type { Chats } from "@/lib/chat-store/types"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { useChatOperations } from "./use-chat-operations"

vi.mock("@/components/ui/toast", () => ({
  toast: vi.fn(),
}))

vi.mock("@/lib/api", () => ({
  checkRateLimits: vi.fn(),
}))

const mockCheckRateLimits = vi.mocked(checkRateLimits)

const localStorageMock = (() => {
  let store = new Map<string, string>()

  return {
    clear: () => {
      store = new Map()
    },
    getItem: (key: string) => store.get(key) ?? null,
    removeItem: (key: string) => {
      store.delete(key)
    },
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
  }
})()

function localChat(id: string): Chats {
  return {
    id,
    title: "Question",
    model: "openai/gpt-5-mini",
    system_prompt: "system",
    user_id: "guest_1",
    public: false,
    project_id: null,
    pinned: false,
    pinned_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  }
}

describe("useChatOperations", () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: localStorageMock,
    })
  })

  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    mockCheckRateLimits.mockResolvedValue({
      remaining: 10,
      remainingPro: 10,
    })
  })

  it("creates and navigates to a fresh guest local chat instead of reusing stale guestChatId", async () => {
    localStorage.setItem(GUEST_CHAT_STORAGE_KEY, "local-stale")
    const createNewChat = vi.fn().mockResolvedValue(localChat("local-fresh"))
    const navigateToChat = vi.fn()

    const { ensureChatExists } = useChatOperations({
      isAuthenticated: false,
      chatId: null,
      selectedModel: "openai/gpt-5-mini",
      systemPrompt: "system",
      createNewChat,
      navigateToChat,
      setHasDialogAuth: vi.fn(),
    })

    const chatId = await ensureChatExists("guest_1", "Question")

    expect(chatId).toBe("local-fresh")
    expect(createNewChat).toHaveBeenCalledWith({
      title: "Question",
      model: "openai/gpt-5-mini",
      systemPrompt: "system",
      guestUserId: "guest_1",
    })
    expect(localStorage.getItem(GUEST_CHAT_STORAGE_KEY)).toBe("local-fresh")
    expect(navigateToChat).toHaveBeenCalledWith("local-fresh")
  })

  it("keeps an already active chat session without creating a new one", async () => {
    const createNewChat = vi.fn()
    const navigateToChat = vi.fn()

    const { ensureChatExists } = useChatOperations({
      isAuthenticated: false,
      chatId: "local-active",
      selectedModel: "openai/gpt-5-mini",
      systemPrompt: "system",
      createNewChat,
      navigateToChat,
      setHasDialogAuth: vi.fn(),
    })

    await expect(ensureChatExists("guest_1", "Question")).resolves.toBe(
      "local-active"
    )
    expect(createNewChat).not.toHaveBeenCalled()
    expect(navigateToChat).not.toHaveBeenCalled()
  })
})
