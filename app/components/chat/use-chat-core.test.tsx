/** @vitest-environment jsdom */

import type { UIMessage } from "@ai-sdk/react"
import { CHAT_TURN_EXECUTION_BUDGET } from "@/lib/chat-turn/execution-budget"
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
  attachStagedFilesToChat: vi.fn(
    async (_convex: unknown, _chatId: string, attachmentIds: string[]) =>
      attachmentIds.map((attachmentId) => ({
        name: "project-notes.pdf",
        contentType: "application/pdf",
        url: `/api/files/${attachmentId}/preview`,
        attachmentId,
      }))
  ),
  bumpChat: vi.fn(),
  convexMutation: vi.fn(),
  regenerate: vi.fn(),
  sendMessage: vi.fn(),
  setMessages: vi.fn(),
  setWebSearchEnabled: vi.fn(),
  stop: vi.fn(),
  bindingStop: vi.fn(),
  updateTitle: vi.fn(),
  // Controllable useChat state for the selected-path projection effect tests.
  useChatState: { messages: [] as unknown[], status: "ready" as string },
  // Controllable Turn context hydration for the auto-submit gate tests.
  turnContextHydrated: true,
  // Controllable selected-run projection for the deferred-Stop tests.
  selectedRun: null as unknown,
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
  useConvexConnectionState: () => ({ isWebSocketConnected: true }),
}))

// The presentation resolver's durable input: guest/local default (no run),
// controllable for the deferred-Stop projection-gap tests.
vi.mock("@/lib/chat-store/messages/provider", () => ({
  useMessages: () => ({ selectedRun: chatCoreMocks.selectedRun }),
}))

vi.mock("@ai-sdk/react", () => ({
  useChat: ({
    chat,
  }: {
    chat: { sendMessage: typeof chatCoreMocks.sendMessage }
  }) => ({
    messages: chatCoreMocks.useChatState.messages,
    sendMessage: chat.sendMessage,
    regenerate: chatCoreMocks.regenerate,
    status: chatCoreMocks.useChatState.status,
    error: undefined,
    stop: chatCoreMocks.stop,
    setMessages: chatCoreMocks.setMessages,
    addToolApprovalResponse: chatCoreMocks.addToolApprovalResponse,
  }),
  // The hook constructs its own Chat instances (detachable stream bindings);
  // the mocked useChat ignores them, but the watchdog stops detached
  // instances directly — route that through a shared spy.
  Chat: class MockChat {
    constructor(
      readonly options: {
        transport: {
          sendMessages: (options: {
            messageId?: string
          }) => Promise<ReadableStream>
        }
      }
    ) {}
    sendMessage = (
      message: { messageId?: string },
      options?: { body?: Record<string, unknown> }
    ) => {
      chatCoreMocks.sendMessage(message, options)
      return this.options.transport
        .sendMessages({ messageId: message.messageId })
        .then(() => undefined)
    }
    stop = () => chatCoreMocks.bindingStop(this.options)
  },
}))

vi.mock("ai", () => ({
  DefaultChatTransport: class MockDefaultChatTransport {
    async sendMessages() {
      return new ReadableStream()
    }
  },
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

vi.mock("@/lib/file-handling", () => ({
  attachStagedFilesToChat: chatCoreMocks.attachStagedFilesToChat,
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
    ensureChatExists = vi.fn(async () => ({ chatId: "chat-project" })),
    checkLimitsAndNotify = vi.fn(async () => true),
  }: {
    search: string
    ensureChatExists?: Parameters<typeof useChatCore>[0]["ensureChatExists"]
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
    const ensureChatExists = vi.fn(async () => ({ chatId: "chat-project" }))

    renderCore({
      search: "?prompt=Project%20question&autoSubmit=1",
      ensureChatExists,
    })
    await flushAsyncWork()

    expect(ensureChatExists).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        text: "Project question",
        clientMessageId: expect.any(String),
        attachmentIds: [],
      })
    )
    expect(chatCoreMocks.sendMessage).toHaveBeenCalledTimes(1)
    expect(chatCoreMocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        role: "user",
        parts: [{ type: "text", text: "Project question" }],
        createdAt: expect.any(Date),
        messageId: expect.any(String),
      }),
      {
        body: expect.objectContaining({
          chatId: "chat-project",
          userId: "user-1",
          model: "openai/gpt-4.1-mini",
          systemPrompt: "system prompt",
          enableSearch: false,
          chatVersion: 1,
          expectedVisibleMessageCount: 0,
        }),
      }
    )
    const dispatchedMessage = chatCoreMocks.sendMessage.mock.calls[0]?.[0]
    expect(dispatchedMessage.messageId).toBe(dispatchedMessage.id)
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
    expect(window.location.search).toBe(
      "?prompt=Project%20question&autoSubmit=1"
    )

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

  function Harness({
    initialMessages,
    chatId = "chat_projection",
  }: {
    initialMessages: UIMessage[]
    chatId?: string | null
  }) {
    useChatCore({
      initialMessages,
      cacheAndAddMessage: vi.fn(),
      chatId,
      user: authenticatedUser,
      checkLimitsAndNotify: vi.fn(async () => true),
      ensureChatExists: vi.fn(async () => ({ chatId: "chat_projection" })),
      bumpChat: chatCoreMocks.bumpChat,
    })
    return null
  }

  function render(initialMessages: UIMessage[], chatId?: string | null) {
    act(() => {
      root?.render(
        <Harness initialMessages={initialMessages} chatId={chatId} />
      )
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

  it("preserves the optimistic user row when a fresh chat route hydrates before persistence", () => {
    mount()
    render([], null)

    const optimisticMessages = [
      {
        id: "optimistic-user",
        role: "user" as const,
        parts: [{ type: "text" as const, text: "hello" }],
      },
    ] as unknown as UIMessage[]
    chatCoreMocks.useChatState.messages = optimisticMessages
    chatCoreMocks.useChatState.status = "streaming"
    chatCoreMocks.setMessages.mockClear()

    render([], "chat_projection")

    expect(chatCoreMocks.setMessages).toHaveBeenCalledTimes(1)
    const update = chatCoreMocks.setMessages.mock.calls[0]?.[0]
    expect(update).toBeTypeOf("function")
    expect(
      (update as (messages: UIMessage[]) => UIMessage[])(optimisticMessages)
    ).toBe(optimisticMessages)
  })

  it("preserves a live assistant when first hydration contains only the persisted user row", () => {
    mount()
    render([], null)

    const liveMessages = [
      {
        id: "optimistic-user",
        role: "user" as const,
        parts: [{ type: "text" as const, text: "hello" }],
      },
      {
        id: "assistant-streaming",
        role: "assistant" as const,
        parts: [{ type: "text" as const, text: "Hi" }],
      },
    ] as unknown as UIMessage[]
    const userOnlyServerPath = [
      {
        ...liveMessages[0],
        metadata: { serverMessageId: "server-user" },
      },
    ] as unknown as UIMessage[]
    chatCoreMocks.useChatState.messages = liveMessages
    chatCoreMocks.useChatState.status = "streaming"
    chatCoreMocks.setMessages.mockClear()

    render(userOnlyServerPath, "chat_projection")

    expect(chatCoreMocks.setMessages).toHaveBeenCalledTimes(1)
    const update = chatCoreMocks.setMessages.mock.calls[0]?.[0]
    expect(update).toBeTypeOf("function")
    const projected = (update as (messages: UIMessage[]) => UIMessage[])(
      liveMessages
    )
    expect(projected.map((message) => message.id)).toEqual([
      "optimistic-user",
      "assistant-streaming",
    ])
  })

  it("stops a detached binding's stream when the watchdog budget elapses", () => {
    vi.useFakeTimers()
    try {
      mount()
      render([], "chat_projection")
      render([], null) // mounted Back to onboarding → detach

      expect(chatCoreMocks.bindingStop).not.toHaveBeenCalled()
      act(() => {
        vi.advanceTimersByTime(
          CHAT_TURN_EXECUTION_BUDGET.clientStreamWatchdogMs
        )
      })
      expect(chatCoreMocks.bindingStop).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("useChatCore deferred durable Stop (projection gap)", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null
  const coreRef: { current: ReturnType<typeof useChatCore> | null } = {
    current: null,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    chatCoreMocks.useChatState.messages = []
    chatCoreMocks.useChatState.status = "ready"
    chatCoreMocks.selectedRun = null
  })

  afterEach(() => {
    const mountedRoot = root
    if (mountedRoot) act(() => mountedRoot.unmount())
    container?.remove()
    container = null
    root = null
    coreRef.current = null
  })

  function Harness() {
    const core = useChatCore({
      initialMessages: [] as UIMessage[],
      cacheAndAddMessage: vi.fn(),
      chatId: "chat_stopgap",
      user: authenticatedUser,
      checkLimitsAndNotify: vi.fn(async () => true),
      ensureChatExists: vi.fn(async () => ({ chatId: "chat_stopgap" })),
      bumpChat: chatCoreMocks.bumpChat,
    })
    React.useEffect(() => {
      coreRef.current = core
    })
    return null
  }

  function render() {
    act(() => {
      root?.render(<Harness />)
    })
  }

  function mount() {
    window.history.replaceState(null, "", "/c/chat_stopgap")
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    render()
  }

  it("defers a Stop clicked before the run projection arrives, then fires at the exact run id", async () => {
    mount()
    // Stop lands in the projection gap: local transport is cut, but no run id
    // is known yet — with durable turns detached from req.signal, dropping
    // the intent here would leave the worker streaming (the review's silent
    // no-op). The intent must fire once the projection delivers the run.
    await act(async () => {
      await coreRef.current?.stop()
    })
    expect(chatCoreMocks.stop).toHaveBeenCalled()
    expect(chatCoreMocks.convexMutation).not.toHaveBeenCalled()

    chatCoreMocks.selectedRun = {
      runId: "run_live",
      assistantMessageId: "msg_live",
      status: "streaming",
      activeToolNames: [],
      pendingApproval: null,
    }
    render()
    await flushAsyncWork()

    expect(chatCoreMocks.convexMutation).toHaveBeenCalledTimes(1)
    expect(chatCoreMocks.convexMutation).toHaveBeenCalledWith({
      chatId: "chat_stopgap",
      runId: "run_live",
    })
  })

  it("disarms without firing when the arriving projection is already terminal", async () => {
    mount()
    await act(async () => {
      await coreRef.current?.stop()
    })

    chatCoreMocks.selectedRun = {
      runId: "run_done",
      assistantMessageId: "msg_done",
      status: "completed",
      activeToolNames: [],
      pendingApproval: null,
    }
    render()
    await flushAsyncWork()

    expect(chatCoreMocks.convexMutation).not.toHaveBeenCalled()
  })
})
