import { SYSTEM_PROMPT_DEFAULT } from "@/lib/config"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  buildChatTurnRequestBody,
  createChatTurnStore,
  prepareEditTurnPlan,
  reconcileRecentMessageIds,
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
  recentMessages = [],
  cachedMessages = [],
}: {
  isAuthenticated?: boolean
  recentMessages?: ChatTurnMessage[]
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
    deleteMessagesFromTimestamp: vi.fn(async () => {}),
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
    getRecentMessages: vi.fn(async () => recentMessages),
    writeCachedMessages: vi.fn(async () => {}),
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

  it("persists local-only assistant finishes and reconciles recent IDs", async () => {
    const assistant = assistantMessage("optimistic-assistant", "answer")
    const harness = createStoreHarness({
      recentMessages: [
        userMessage("server-user", "question"),
        assistantMessage("server-assistant", "answer"),
      ],
    })
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
    expect(harness.adapters.getRecentMessages).toHaveBeenCalledWith(
      "local-chat",
      2
    )
    expect(harness.getMessages().map((message) => message.id)).toEqual([
      "server-user",
      "server-assistant",
    ])
    expect(harness.adapters.writeCachedMessages).toHaveBeenCalledWith(
      "local-chat",
      harness.getMessages()
    )
  })

  it("skips local assistant persistence for durable route-persisted finishes but still reconciles", async () => {
    const assistant = assistantMessage("optimistic-assistant", "answer")
    const harness = createStoreHarness({
      isAuthenticated: true,
      recentMessages: [assistantMessage("server-assistant", "answer")],
    })
    harness.setMessages([assistant])

    await harness.store.finishTurn({
      message: assistant,
      isAbort: false,
      isDisconnect: false,
      isError: false,
      chatId: "server-chat",
      previousChatId: null,
    })

    expect(harness.adapters.cacheAndAddMessage).not.toHaveBeenCalled()
    expect(harness.adapters.getRecentMessages).toHaveBeenCalledWith(
      "server-chat",
      2
    )
    expect(harness.getMessages().map((message) => message.id)).toEqual([
      "server-assistant",
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
    expect(local.adapters.getRecentMessages).not.toHaveBeenCalled()

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
    expect(durable.adapters.getRecentMessages).toHaveBeenCalledWith(
      "server-chat",
      2
    )
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
    expect(harness.adapters.getRecentMessages).not.toHaveBeenCalled()
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

  it("reconciles durable aborts instead of returning before cleanup", async () => {
    const emptyAssistant: ChatTurnMessage = {
      id: "empty-assistant",
      role: "assistant",
      parts: [],
    }
    const harness = createStoreHarness({
      isAuthenticated: true,
      recentMessages: [userMessage("server-user", "prompt")],
    })
    harness.setMessages([userMessage("optimistic-user", "prompt"), emptyAssistant])

    await harness.store.finishTurn({
      message: emptyAssistant,
      isAbort: true,
      isDisconnect: false,
      isError: false,
      chatId: "server-chat",
      previousChatId: null,
    })

    expect(harness.adapters.cacheAndAddMessage).not.toHaveBeenCalled()
    expect(harness.adapters.getRecentMessages).toHaveBeenCalledWith(
      "server-chat",
      2
    )
    expect(harness.getMessages().map((message) => message.id)).toEqual([
      "server-user",
    ])
  })

  it("prepares local edit transactions without committing until dispatch is accepted", async () => {
    const originalMessages = [
      userMessage("user-1", "old"),
      assistantMessage("assistant-1", "answer"),
      userMessage("user-2", "later"),
      assistantMessage("assistant-2", "later answer"),
    ]
    const harness = createStoreHarness({ cachedMessages: originalMessages })
    const editPlan = prepareEditTurnPlan({
      messages: originalMessages,
      messageId: "user-1",
      newContent: "new",
      createOptimisticEditMessageId: () => "optimistic-edit",
    })
    expect(editPlan.ok).toBe(true)
    if (!editPlan.ok) return

    const transaction = await harness.store.prepareEditPersistence({
      sourceChatId: "local-chat",
      targetChatId: "local-chat",
      plan: editPlan,
    })

    expect(transaction.routePersists).toBe(false)
    expect(harness.adapters.readMessages).toHaveBeenCalledWith("local-chat")
    expect(harness.adapters.writeMessages).not.toHaveBeenCalled()

    await transaction.accept()

    expect(harness.adapters.writeMessages).toHaveBeenCalledWith(
      "local-chat",
      []
    )
  })

  it("restores local edit transaction snapshots on rollback", async () => {
    const originalMessages = [
      userMessage("user-1", "old"),
      assistantMessage("assistant-1", "answer"),
      userMessage("user-2", "later"),
      assistantMessage("assistant-2", "later answer"),
    ]
    const harness = createStoreHarness({ cachedMessages: originalMessages })
    harness.setMessages([userMessage("optimistic-edit", "new")])
    const editPlan = prepareEditTurnPlan({
      messages: originalMessages,
      messageId: "user-1",
      newContent: "new",
      createOptimisticEditMessageId: () => "optimistic-edit",
    })
    expect(editPlan.ok).toBe(true)
    if (!editPlan.ok) return

    const transaction = await harness.store.prepareEditPersistence({
      sourceChatId: "local-chat",
      targetChatId: "local-chat",
      plan: editPlan,
    })

    await transaction.rollback()

    expect(harness.getMessages()).toEqual(originalMessages)
    expect(harness.adapters.writeMessages).toHaveBeenCalledWith(
      "local-chat",
      originalMessages
    )
    expect(harness.getPendingEdit()).toBeNull()
  })

  it("rolls back active local edit transactions when the replacement stream fails", async () => {
    const originalMessages = [
      userMessage("user-1", "old"),
      assistantMessage("assistant-1", "answer"),
      userMessage("user-2", "later"),
      assistantMessage("assistant-2", "later answer"),
    ]
    const harness = createStoreHarness({ cachedMessages: originalMessages })
    const editPlan = prepareEditTurnPlan({
      messages: originalMessages,
      messageId: "user-1",
      newContent: "new",
      createOptimisticEditMessageId: () => "optimistic-edit",
    })
    expect(editPlan.ok).toBe(true)
    if (!editPlan.ok) return

    const transaction = await harness.store.prepareEditPersistence({
      sourceChatId: "local-chat",
      targetChatId: "local-chat",
      plan: editPlan,
    })
    await transaction.accept()
    harness.adapters.pendingEdit.stage(editPlan.optimisticEditedMessage, "local-chat")
    harness.setMessages([editPlan.optimisticEditedMessage])

    await harness.store.finishTurn({
      message: assistantMessage("assistant-new", "failed"),
      isAbort: false,
      isDisconnect: false,
      isError: true,
      chatId: "local-chat",
      previousChatId: null,
    })

    expect(harness.getMessages()).toEqual(originalMessages)
    expect(harness.adapters.writeMessages).toHaveBeenLastCalledWith(
      "local-chat",
      originalMessages
    )
    expect(harness.adapters.cacheAndAddMessage).not.toHaveBeenCalled()
    expect(harness.getPendingEdit()).toBeNull()
  })

  it("does not call client-side deletion for durable edit preparation", async () => {
    const harness = createStoreHarness({ isAuthenticated: true })
    const targetCreatedAt = new Date("2026-01-02T00:00:00.000Z")
    const editPlan = prepareEditTurnPlan({
      messages: [
        userMessage("user-1", "old", targetCreatedAt),
        assistantMessage("assistant-1", "answer"),
      ],
      messageId: "user-1",
      newContent: "new",
      createOptimisticEditMessageId: () => "optimistic-edit",
    })
    expect(editPlan.ok).toBe(true)
    if (!editPlan.ok) return

    const transaction = await harness.store.prepareEditPersistence({
      sourceChatId: "server-chat",
      targetChatId: "server-chat",
      plan: editPlan,
    })
    await transaction.accept()

    expect(transaction.routePersists).toBe(true)
    expect(harness.adapters.deleteMessagesFromTimestamp).not.toHaveBeenCalled()
    expect(harness.adapters.writeMessages).not.toHaveBeenCalled()
    expect(harness.adapters.updateTitle).not.toHaveBeenCalled()
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
      })
    ).toEqual({
      chatId: "chat-1",
      userId: "user-1",
      model: "model-1",
      isAuthenticated: true,
      systemPrompt: "custom system",
      enableSearch: false,
      chatVersion: 2,
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
  })

  it("reconciles recent IDs without duplicating overlapping cached IDs", () => {
    const currentMessages = [
      userMessage("server-user", "old question"),
      userMessage("optimistic-user", "question"),
      assistantMessage("optimistic-assistant", "answer"),
    ]
    const reconciled = reconcileRecentMessageIds(currentMessages, [
      userMessage("server-user", "question"),
      assistantMessage("server-assistant", "answer"),
    ])

    expect(reconciled.map((message) => message.id)).toEqual([
      "server-user",
      "optimistic-user",
      "server-assistant",
    ])
    expect(new Set(reconciled.map((message) => message.id)).size).toBe(
      reconciled.length
    )
  })
})
