import { SYSTEM_PROMPT_DEFAULT } from "@/lib/config"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  buildEditIntent,
  buildChatTurnRequestBody,
  buildSelectedPathToken,
  createChatTurnStore,
  prepareEditTurnPlan,
  prepareRegenerationTurnPlan,
  type ChatTurnMessage,
} from "./chat-turn-service"

function userMessage(
  id: string,
  text: string,
  createdAt = new Date("2026-01-01T00:00:00.000Z")
): ChatTurnMessage {
  return {
    id,
    role: "user",
    createdAt,
    parts: [{ type: "text", text }],
  }
}

function assistantMessage(
  id: string,
  text: string,
  createdAt = new Date("2026-01-01T00:00:01.000Z")
): ChatTurnMessage {
  return {
    id,
    role: "assistant",
    createdAt,
    parts: [{ type: "text", text }],
  }
}

function createStoreHarness({
  isAuthenticated = false,
  cachedMessages = [],
}: {
  isAuthenticated?: boolean
  cachedMessages?: ChatTurnMessage[]
} = {}) {
  let messages: ChatTurnMessage[] = []
  let pendingEdit: { message: ChatTurnMessage; chatId: string } | null = null

  const adapters = {
    isAuthenticated: vi.fn(() => isAuthenticated),
    updateMessages: vi.fn(
      (updater: (prev: ChatTurnMessage[]) => ChatTurnMessage[]) => {
        messages = updater(messages)
      }
    ),
    cacheAndAddMessage: vi.fn(async () => {}),
    updateTitle: vi.fn(async () => {}),
    pendingEdit: {
      get: vi.fn(() => pendingEdit),
      stage: vi.fn((message: ChatTurnMessage, chatId: string) => {
        pendingEdit = { message, chatId }
      }),
      clear: vi.fn(() => {
        pendingEdit = null
      }),
    },
    getStoredGuestChatId: vi.fn(() => null),
    readMessages: vi.fn(async () => cachedMessages),
    writeMessages: vi.fn(async () => {}),
    reportError: vi.fn(() => {}),
  }

  return {
    adapters,
    store: createChatTurnStore(adapters),
    setMessages: (nextMessages: ChatTurnMessage[]) => {
      messages = nextMessages
    },
    getMessages: () => messages,
    getPendingEdit: () => pendingEdit,
  }
}

describe("chat turn service", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("persists local-only assistant finishes without rewriting live ids", async () => {
    // Identity adoption is owned solely by the branch projection seam
    // (lib/chat-store/turns/selected-path.ts). finishTurn persists; it no
    // longer patches the live array's ids.
    const assistant = assistantMessage("optimistic-assistant", "answer")
    const harness = createStoreHarness()
    harness.setMessages([userMessage("optimistic-user", "question"), assistant])

    await harness.store.finishTurn({
      message: assistant,
      isAbort: false,
      isDisconnect: false,
      isError: false,
      chatId: "local-chat",
      previousChatId: null,
    })

    expect(harness.adapters.cacheAndAddMessage).toHaveBeenCalledWith(
      assistant,
      "local-chat"
    )
    expect(harness.getMessages().map((message) => message.id)).toEqual([
      "optimistic-user",
      "optimistic-assistant",
    ])
  })

  it("skips local assistant persistence for durable route-persisted finishes", async () => {
    const assistant = assistantMessage("optimistic-assistant", "answer")
    const harness = createStoreHarness({ isAuthenticated: true })
    harness.setMessages([assistant])

    await harness.store.finishTurn({
      message: assistant,
      isAbort: false,
      isDisconnect: false,
      isError: false,
      chatId: "server-chat",
      previousChatId: null,
    })

    // The durable route persists server-side; the client neither caches nor
    // rewrites ids — the reactive selected path + projection seam converge it.
    expect(harness.adapters.cacheAndAddMessage).not.toHaveBeenCalled()
    expect(harness.getMessages().map((message) => message.id)).toEqual([
      "optimistic-assistant",
    ])
  })

  it("persists pending edits on abort or error only for local persistence mode", async () => {
    const local = createStoreHarness()
    const editedMessage = userMessage("edited-user", "edited")
    local.adapters.pendingEdit.stage(editedMessage, "local-chat")

    await local.store.finishTurn({
      message: assistantMessage("assistant", "answer"),
      isAbort: false,
      isDisconnect: false,
      isError: true,
      chatId: "local-chat",
      previousChatId: null,
    })

    expect(local.adapters.cacheAndAddMessage).toHaveBeenCalledWith(
      editedMessage,
      "local-chat"
    )
    expect(local.getPendingEdit()).toBeNull()

    const durable = createStoreHarness({ isAuthenticated: true })
    durable.adapters.pendingEdit.stage(editedMessage, "server-chat")

    await durable.store.finishTurn({
      message: assistantMessage("assistant", "answer"),
      isAbort: true,
      isDisconnect: false,
      isError: false,
      chatId: "server-chat",
      previousChatId: null,
    })

    expect(durable.adapters.cacheAndAddMessage).not.toHaveBeenCalled()
    expect(durable.getPendingEdit()).toBeNull()
  })

  it("removes empty local assistant messages after abort before the first chunk", async () => {
    const emptyAssistant: ChatTurnMessage = {
      id: "empty-assistant",
      role: "assistant",
      parts: [],
    }
    const user = userMessage("user-1", "prompt")
    const harness = createStoreHarness({
      cachedMessages: [user, emptyAssistant],
    })
    harness.setMessages([user, emptyAssistant])

    await harness.store.finishTurn({
      message: emptyAssistant,
      isAbort: true,
      isDisconnect: false,
      isError: false,
      chatId: "local-chat",
      previousChatId: null,
    })

    expect(harness.getMessages()).toEqual([user])
    expect(harness.adapters.writeMessages).toHaveBeenCalledWith("local-chat", [
      user,
    ])
    expect(harness.adapters.cacheAndAddMessage).not.toHaveBeenCalled()
  })

  it("preserves partial local assistant messages after abort", async () => {
    const partialAssistant = assistantMessage(
      "partial-assistant",
      "partial answer"
    )
    const harness = createStoreHarness()
    harness.setMessages([userMessage("user-1", "prompt"), partialAssistant])

    await harness.store.finishTurn({
      message: partialAssistant,
      isAbort: true,
      isDisconnect: false,
      isError: false,
      chatId: "local-chat",
      previousChatId: null,
    })

    expect(harness.adapters.cacheAndAddMessage).toHaveBeenCalledWith(
      partialAssistant,
      "local-chat"
    )
    expect(harness.getMessages().map((message) => message.id)).toEqual([
      "user-1",
      "partial-assistant",
    ])
  })

  it("cleans up empty assistant on durable abort instead of returning early", async () => {
    const emptyAssistant: ChatTurnMessage = {
      id: "empty-assistant",
      role: "assistant",
      parts: [],
    }
    const harness = createStoreHarness({ isAuthenticated: true })
    harness.setMessages([
      userMessage("optimistic-user", "prompt"),
      emptyAssistant,
    ])

    await harness.store.finishTurn({
      message: emptyAssistant,
      isAbort: true,
      isDisconnect: false,
      isError: false,
      chatId: "server-chat",
      previousChatId: null,
    })

    expect(harness.adapters.cacheAndAddMessage).not.toHaveBeenCalled()
    // The empty assistant is removed; identity of the remaining message is left
    // to the reactive selected path + projection seam, not patched here.
    expect(harness.getMessages().map((message) => message.id)).toEqual([
      "optimistic-user",
    ])
  })

  it("prepares regeneration intent for the targeted latest assistant", () => {
    const targetCreatedAt = new Date("2026-01-02T00:00:00.000Z")
    const messages = [
      userMessage("user-1", "first"),
      assistantMessage("assistant-1", "first answer"),
      userMessage("user-2", "second"),
      assistantMessage("assistant-2", "second answer", targetCreatedAt),
    ]

    const plan = prepareRegenerationTurnPlan(messages, "assistant-2")

    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.regeneration).toEqual({
      targetAssistantMessageId: "assistant-2",
      targetAssistantCreatedAt: targetCreatedAt.getTime(),
      expectedChatVersion: 4,
      precedingUserMessageId: "user-2",
    })
    expect(plan.retainedMessages.map((message) => message.id)).toEqual([
      "user-1",
      "assistant-1",
      "user-2",
    ])
  })

  it("prepares regeneration after a stopped turn without retaining stale empty placeholders", () => {
    const targetCreatedAt = new Date("2026-01-02T00:00:00.000Z")
    const emptyAssistant: ChatTurnMessage = {
      id: "empty-assistant",
      role: "assistant",
      parts: [],
    }
    const partialAssistant = assistantMessage(
      "partial-assistant",
      "partial answer"
    )
    const targetAssistant = assistantMessage(
      "assistant-2",
      "second answer",
      targetCreatedAt
    )
    const messages = [
      userMessage("user-1", "first"),
      partialAssistant,
      emptyAssistant,
      userMessage("user-2", "second"),
      targetAssistant,
    ]
    const plan = prepareRegenerationTurnPlan(messages, "assistant-2")

    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.originalMessages.map((message) => message.id)).toEqual([
      "user-1",
      "partial-assistant",
      "user-2",
      "assistant-2",
    ])
    expect(plan.retainedMessages.map((message) => message.id)).toEqual([
      "user-1",
      "partial-assistant",
      "user-2",
    ])
    expect(plan.regeneration.expectedChatVersion).toBe(4)
  })

  it("prepares edit truncation after stopped or regenerated turns without stale empty placeholders", () => {
    const emptyAssistant: ChatTurnMessage = {
      id: "empty-assistant",
      role: "assistant",
      parts: [],
    }
    const partialAssistant = assistantMessage(
      "partial-assistant",
      "partial answer"
    )
    const regeneratedAssistant = assistantMessage(
      "assistant-2",
      "regenerated answer"
    )
    const messages = [
      userMessage("user-1", "first"),
      partialAssistant,
      emptyAssistant,
      userMessage("user-2", "second"),
      regeneratedAssistant,
    ]

    const plan = prepareEditTurnPlan({
      messages,
      messageId: "user-2",
      newContent: "edited second",
      createOptimisticEditMessageId: () => "optimistic-edit",
    })

    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.originalMessages.map((message) => message.id)).toEqual([
      "user-1",
      "partial-assistant",
      "user-2",
      "assistant-2",
    ])
    expect(plan.trimmedMessages.map((message) => message.id)).toEqual([
      "user-1",
      "partial-assistant",
    ])
    expect(plan.expectedChatVersion).toBe(4)
    expect(plan.chatVersion).toBe(3)
  })

  it("builds edit intents for AI SDK client message IDs", () => {
    const targetCreatedAt = new Date("2026-01-02T00:00:00.000Z")
    const clientMessageId = "msg-client-123"
    const plan = prepareEditTurnPlan({
      messages: [
        userMessage(clientMessageId, "old text", targetCreatedAt),
        assistantMessage("assistant-1", "old answer"),
      ],
      messageId: clientMessageId,
      newContent: "new text",
      createOptimisticEditMessageId: () => "optimistic-edit",
    })

    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.trimmedMessages).toEqual([])
    expect(plan.cutoffTimestamp).toBe(targetCreatedAt.getTime())
    expect(plan.optimisticEditedMessage).toMatchObject({
      id: "optimistic-edit",
      role: "user",
      parts: [{ type: "text", text: "new text" }],
    })
    expect(buildEditIntent(clientMessageId, plan)).toMatchObject({
      editedMessageId: clientMessageId,
      editCutoffTimestamp: targetCreatedAt.getTime(),
      replacementMessage: {
        id: "optimistic-edit",
        role: "user",
        content: "new text",
        parts: [{ type: "text", text: "new text" }],
      },
    })
  })

  it("rejects invalid regeneration targets", () => {
    expect(
      prepareRegenerationTurnPlan([userMessage("user-1", "prompt")], "user-1")
    ).toEqual({ ok: false, reason: "invalid-target-role" })

    expect(
      prepareRegenerationTurnPlan(
        [
          userMessage("user-1", "prompt"),
          {
            id: "assistant-1",
            role: "assistant",
            parts: [{ type: "text", text: "answer" }],
          },
        ],
        "assistant-1"
      )
    ).toEqual({ ok: false, reason: "missing-message-timestamp" })

    expect(
      prepareRegenerationTurnPlan(
        [assistantMessage("assistant-1", "answer")],
        "assistant-1"
      )
    ).toEqual({ ok: false, reason: "missing-preceding-user" })
  })

  it("accepts a non-tail assistant regeneration target", () => {
    const plan = prepareRegenerationTurnPlan(
      [
        userMessage("user-1", "first"),
        assistantMessage("assistant-1", "first answer"),
        userMessage("user-2", "second"),
        assistantMessage("assistant-2", "second answer"),
      ],
      "assistant-1"
    )

    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.retainedMessages.map((message) => message.id)).toEqual([
      "user-1",
    ])
    expect(plan.regeneration).toMatchObject({
      targetAssistantMessageId: "assistant-1",
      precedingUserMessageId: "user-1",
      expectedChatVersion: 4,
    })
  })

  it("builds consistent request bodies for send, edit, and regeneration turns", () => {
    const base = {
      chatId: "chat-1",
      userId: "user-1",
      selectedModel: "model-1",
      isAuthenticated: true,
    }

    expect(
      buildChatTurnRequestBody({
        ...base,
        bodyExtras: {
          systemPrompt: "custom system",
          enableSearch: true,
          chatVersion: 3,
        },
      })
    ).toEqual({
      chatId: "chat-1",
      userId: "user-1",
      model: "model-1",
      isAuthenticated: true,
      systemPrompt: "custom system",
      enableSearch: true,
      chatVersion: 3,
    })

    expect(
      buildChatTurnRequestBody({
        ...base,
        systemPrompt: "custom system",
        enableSearch: false,
        chatVersion: 2,
        selectedPathToken: {
          expectedVisibleMessageCount: 2,
          tailMessageId: "message_assistant_1",
        },
      })
    ).toEqual({
      chatId: "chat-1",
      userId: "user-1",
      model: "model-1",
      isAuthenticated: true,
      systemPrompt: "custom system",
      enableSearch: false,
      chatVersion: 2,
      expectedVisibleMessageCount: 2,
      tailMessageId: "message_assistant_1",
    })

    expect(
      buildChatTurnRequestBody({
        ...base,
        chatId: null,
        chatVersion: 1,
      })
    ).toEqual({
      chatId: null,
      userId: "user-1",
      model: "model-1",
      isAuthenticated: true,
      systemPrompt: SYSTEM_PROMPT_DEFAULT,
      chatVersion: 1,
    })

    const regeneration = {
      targetAssistantMessageId: "assistant-1",
      targetAssistantCreatedAt: 1700000000000,
      expectedChatVersion: 2,
      precedingUserMessageId: "user-1",
    }
    expect(
      buildChatTurnRequestBody({
        ...base,
        chatVersion: 2,
        regeneration,
      })
    ).toEqual({
      chatId: "chat-1",
      userId: "user-1",
      model: "model-1",
      isAuthenticated: true,
      systemPrompt: SYSTEM_PROMPT_DEFAULT,
      chatVersion: 2,
      regeneration,
    })
  })

  it("builds selected-path tokens from visible durable server message ids", () => {
    expect(
      buildSelectedPathToken([
        {
          ...userMessage("client-user-1", "prompt"),
          metadata: { serverMessageId: "message_user_1" },
        },
        {
          ...assistantMessage("client-assistant-1", "answer"),
          metadata: { serverMessageId: "message_assistant_1" },
        },
      ])
    ).toEqual({
      expectedVisibleMessageCount: 2,
      tailMessageId: "message_assistant_1",
    })

    expect(buildSelectedPathToken([])).toEqual({
      expectedVisibleMessageCount: 0,
    })
  })

  it("reads the selected-path token tail through the typed serverMessageId accessor", () => {
    // Guards the readServerMessageId contract the token now depends on:
    // an empty or non-string serverMessageId must yield no tail anchor.
    expect(
      buildSelectedPathToken([
        {
          ...assistantMessage("client-assistant-1", "answer"),
          metadata: { serverMessageId: "" },
        },
      ])
    ).toEqual({ expectedVisibleMessageCount: 1 })

    expect(
      buildSelectedPathToken([
        {
          ...assistantMessage("client-assistant-1", "answer"),
          metadata: { serverMessageId: 123 as unknown as string },
        },
      ])
    ).toEqual({ expectedVisibleMessageCount: 1 })
  })
})
