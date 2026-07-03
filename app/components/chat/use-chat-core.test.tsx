/** @vitest-environment jsdom */

import type { UIMessage } from "@ai-sdk/react"
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

let useChatCore: (typeof import("./use-chat-core"))["useChatCore"]

const chatCoreMocks = vi.hoisted(() => ({
  addToolApprovalResponse: vi.fn(),
  bumpChat: vi.fn(),
  convexMutation: vi.fn(),
  regenerate: vi.fn(),
  sendMessage: vi.fn(),
  setMessages: vi.fn(),
  setWebSearchEnabled: vi.fn(),
  stop: vi.fn(),
  updateTitle: vi.fn(),
  // Controllable useChat state for the selected-path projection effect tests.
  useChatState: { messages: [] as unknown[], status: "ready" as string },
  // Controllable Turn context hydration for the auto-submit gate tests.
  turnContextHydrated: true,
}))

vi.mock("./turn-context", () => ({
  useTurnContext: () => ({
    selectedModel: "openai/gpt-4.1-mini",
    handleModelChange: vi.fn(),
    enableSearch: false,
    setEnableSearch: chatCoreMocks.setWebSearchEnabled,
    isAuthenticated: true,
    systemPrompt: "system prompt",
    isHydrated: chatCoreMocks.turnContextHydrated,
    getTurnSnapshot: () => ({
      selectedModel: "openai/gpt-4.1-mini",
      systemPrompt: "system prompt",
      enableSearch: false,
      isAuthenticated: true,
      isHydrated: chatCoreMocks.turnContextHydrated,
    }),
  }),
}))

vi.mock("@/convex/_generated/api", () => ({
  api: {
    chatRuntime: {
      approveToolCall: "approveToolCall",
      denyToolCall: "denyToolCall",
    },
  },
}))

vi.mock("convex/react", () => ({
  useMutation: () => chatCoreMocks.convexMutation,
  useConvex: () => ({}),
}))

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: chatCoreMocks.useChatState.messages,
    sendMessage: chatCoreMocks.sendMessage,
    regenerate: chatCoreMocks.regenerate,
    status: chatCoreMocks.useChatState.status,
    error: undefined,
    stop: chatCoreMocks.stop,
    setMessages: chatCoreMocks.setMessages,
    addToolApprovalResponse: chatCoreMocks.addToolApprovalResponse,
  }),
}))

vi.mock("ai", () => ({
  DefaultChatTransport: vi.fn(function DefaultChatTransport() {}),
  lastAssistantMessageIsCompleteWithApprovalResponses: vi.fn(() => false),
}))

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}))

vi.mock("@/components/ui/toast", () => ({
  toast: vi.fn(),
}))

vi.mock("@/lib/api", () => ({
  getOrCreateGuestUserId: vi.fn(async (user: { id?: string } | null) =>
    user?.id ? user.id : "guest_1"
  ),
}))

vi.mock("@/lib/chat-store/chats/provider", () => ({
  useChats: () => ({
    updateTitle: chatCoreMocks.updateTitle,
  }),
}))

const authenticatedUser = {
  id: "user-1",
  email: "user@example.com",
  display_name: "User",
  profile_image: null,
  anonymous: false,
  premium: true,
  message_count: 0,
  daily_message_count: 0,
  daily_reset: null,
  daily_pro_message_count: 0,
  daily_pro_reset: null,
  last_active_at: null,
  created_at: null,
  favorite_models: null,
  system_prompt: "system prompt",
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe("useChatCore prompt query handling", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeAll(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    ;(
      globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }
    ).requestAnimationFrame = (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0)
    const objectStoreNames = Object.assign(["chats", "messages", "sync"], {
      contains: (name: string) => ["chats", "messages", "sync"].includes(name),
    })
    const db = {
      version: 2,
      objectStoreNames,
      close: vi.fn(),
      createObjectStore: vi.fn(),
    }
    ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = {
      open: vi.fn(() => {
        const request = {
          result: db,
          error: null,
        } as unknown as IDBOpenDBRequest
        window.setTimeout(() => request.onsuccess?.(new Event("success")), 0)
        return request
      }),
      deleteDatabase: vi.fn(() => {
        const request = { result: undefined } as unknown as IDBOpenDBRequest
        window.setTimeout(() => request.onsuccess?.(new Event("success")), 0)
        return request
      }),
    } as unknown as IDBFactory
  })

  beforeAll(async () => {
    ;({ useChatCore } = await import("./use-chat-core"))
  })

  beforeEach(() => {
    vi.clearAllMocks()
    chatCoreMocks.turnContextHydrated = true
  })

  afterEach(() => {
    const mountedRoot = root
    if (mountedRoot) {
      act(() => {
        mountedRoot.unmount()
      })
    }
    container?.remove()
    container = null
    root = null
  })

  function renderCore({
    search,
    ensureChatExists = vi.fn(async () => "chat-project"),
    checkLimitsAndNotify = vi.fn(async () => true),
  }: {
    search: string
    ensureChatExists?: (uid: string, input: string) => Promise<string | null>
    checkLimitsAndNotify?: (uid: string) => Promise<boolean>
  }) {
    window.history.replaceState(null, "", `/c/chat-project${search}`)

    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    function Harness() {
      useChatCore({
        initialMessages: [] as UIMessage[],
        cacheAndAddMessage: vi.fn(),
        chatId: "chat-project",
        user: authenticatedUser,
        checkLimitsAndNotify,
        ensureChatExists,
        bumpChat: chatCoreMocks.bumpChat,
      })
      return null
    }

    const rerender = () => {
      act(() => {
        root?.render(
          <React.StrictMode>
            <Harness />
          </React.StrictMode>
        )
      })
    }
    rerender()

    return { checkLimitsAndNotify, ensureChatExists, rerender }
  }

  it("keeps prompt-only links as composer hydration without dispatching", async () => {
    renderCore({ search: "?prompt=Project%20question" })
    await flushAsyncWork()

    expect(chatCoreMocks.sendMessage).not.toHaveBeenCalled()
    expect(window.location.search).toBe("?prompt=Project%20question")
  })

  it("auto-submits a transferred project prompt once through the chat turn", async () => {
    const ensureChatExists = vi.fn(async () => "chat-project")

    renderCore({
      search: "?prompt=Project%20question&autoSubmit=1",
      ensureChatExists,
    })
    await flushAsyncWork()

    expect(ensureChatExists).toHaveBeenCalledWith("user-1", "Project question")
    expect(chatCoreMocks.sendMessage).toHaveBeenCalledTimes(1)
    expect(chatCoreMocks.sendMessage).toHaveBeenCalledWith(
      {
        text: "Project question",
        files: undefined,
      },
      {
        body: expect.objectContaining({
          chatId: "chat-project",
          userId: "user-1",
          model: "openai/gpt-4.1-mini",
          isAuthenticated: true,
          systemPrompt: "system prompt",
          enableSearch: false,
          chatVersion: 1,
          expectedVisibleMessageCount: 0,
        }),
      }
    )
    expect(window.location.pathname).toBe("/c/chat-project")
    expect(window.location.search).toBe("")
  })

  it("defers auto-submit until the Turn context hydrates, then dispatches once", async () => {
    // The headline staleness fix: the turn must not dispatch with the tier
    // default model while model prefs are still hydrating. The gate must run
    // BEFORE the once-guard is consumed, so the deferred prompt still sends
    // after hydration.
    chatCoreMocks.turnContextHydrated = false

    const { rerender } = renderCore({
      search: "?prompt=Project%20question&autoSubmit=1",
    })
    await flushAsyncWork()

    expect(chatCoreMocks.sendMessage).not.toHaveBeenCalled()
    // The URL cleanup must also wait — the prompt params survive the deferral.
    expect(window.location.search).toBe("?prompt=Project%20question&autoSubmit=1")

    chatCoreMocks.turnContextHydrated = true
    rerender()
    await flushAsyncWork()

    expect(chatCoreMocks.sendMessage).toHaveBeenCalledTimes(1)
    expect(window.location.search).toBe("")
  })
})

describe("useChatCore selected-path projection", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    chatCoreMocks.useChatState.messages = []
    chatCoreMocks.useChatState.status = "ready"
  })

  afterEach(() => {
    const mountedRoot = root
    if (mountedRoot) act(() => mountedRoot.unmount())
    container?.remove()
    container = null
    root = null
  })

  function Harness({ initialMessages }: { initialMessages: UIMessage[] }) {
    useChatCore({
      initialMessages,
      cacheAndAddMessage: vi.fn(),
      chatId: "chat_projection",
      user: authenticatedUser,
      checkLimitsAndNotify: vi.fn(async () => true),
      ensureChatExists: vi.fn(async () => "chat_projection"),
      bumpChat: chatCoreMocks.bumpChat,
    })
    return null
  }

  function render(initialMessages: UIMessage[]) {
    act(() => {
      root?.render(<Harness initialMessages={initialMessages} />)
    })
  }

  const serverPath = [
    {
      id: "s1",
      role: "user" as const,
      parts: [{ type: "text" as const, text: "hi" }],
      metadata: { serverMessageId: "s1" },
    },
  ] as unknown as UIMessage[]

  function mount() {
    window.history.replaceState(null, "", "/c/chat_projection")
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  }

  it("projects the reactive server selected path into useChat when idle", () => {
    mount()
    render([]) // hydrates the empty chat
    chatCoreMocks.setMessages.mockClear()

    render(serverPath) // a reactive server update while idle

    expect(chatCoreMocks.setMessages).toHaveBeenCalledWith(serverPath)
  })

  it("does not project while a generation is streaming", () => {
    mount()
    render([])
    chatCoreMocks.useChatState.status = "streaming"
    chatCoreMocks.setMessages.mockClear()

    render(serverPath) // server update arrives mid-stream

    expect(chatCoreMocks.setMessages).not.toHaveBeenCalled()
  })
})
