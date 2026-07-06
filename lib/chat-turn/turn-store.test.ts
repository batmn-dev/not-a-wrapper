import { beforeEach, describe, expect, it, vi } from "vitest"
import { assistantMessage, userMessage } from "./fixtures"
import { type ChatTurnMessage } from "./turn-plans"
import { createChatTurnStore } from "./turn-store"

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

describe("chat turn store", () => {
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

  it("persists success-path pending edits under the effective chat id", async () => {
    const harness = createStoreHarness()
    const editedMessage = userMessage("edited-user", "edited")
    const assistant = assistantMessage("assistant", "answer")
    harness.adapters.pendingEdit.stage(editedMessage, "local-stale")

    await harness.store.finishTurn({
      message: assistant,
      isAbort: false,
      isDisconnect: false,
      isError: false,
      chatId: null,
      previousChatId: "local-current",
    })

    expect(harness.adapters.cacheAndAddMessage).toHaveBeenNthCalledWith(
      1,
      editedMessage,
      "local-current"
    )
    expect(harness.adapters.cacheAndAddMessage).toHaveBeenNthCalledWith(
      2,
      assistant,
      "local-current"
    )
    expect(harness.getPendingEdit()).toBeNull()
  })

  it("keeps success-path pending edits staged when local persistence fails", async () => {
    const harness = createStoreHarness()
    const editedMessage = userMessage("edited-user", "edited")
    harness.adapters.pendingEdit.stage(editedMessage, "local-chat")
    harness.adapters.cacheAndAddMessage.mockRejectedValueOnce(
      new Error("cache failed")
    )

    await harness.store.finishTurn({
      message: assistantMessage("assistant", "answer"),
      isAbort: false,
      isDisconnect: false,
      isError: false,
      chatId: "local-chat",
      previousChatId: null,
    })

    expect(harness.adapters.cacheAndAddMessage).toHaveBeenCalledTimes(1)
    expect(harness.adapters.reportError).toHaveBeenCalledWith(
      "Failed to persist pending edited message:",
      expect.any(Error)
    )
    expect(harness.adapters.pendingEdit.clear).not.toHaveBeenCalled()
    expect(harness.getPendingEdit()).toEqual({
      message: editedMessage,
      chatId: "local-chat",
    })
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

  it("keeps terminal failed/aborted stubs when cleaning up empty assistants", async () => {
    // A projected terminal stub (durable status) is the turn's visible failed
    // state — the abort/error cleanup may only remove the SDK's transient
    // empty message (no status), or the stub silently vanishes.
    const sdkEmpty: ChatTurnMessage = {
      id: "sdk-empty",
      role: "assistant",
      parts: [],
    }
    const failedStub: ChatTurnMessage = {
      id: "failed-stub",
      role: "assistant",
      parts: [],
      status: "failed",
    }
    const harness = createStoreHarness({ isAuthenticated: true })
    harness.setMessages([userMessage("user-1", "prompt"), failedStub, sdkEmpty])

    await harness.store.finishTurn({
      message: sdkEmpty,
      isAbort: false,
      isDisconnect: false,
      isError: true,
      chatId: "server-chat",
      previousChatId: null,
    })

    expect(harness.getMessages().map((message) => message.id)).toEqual([
      "user-1",
      "failed-stub",
    ])
  })
})
