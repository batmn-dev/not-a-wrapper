import { SYSTEM_PROMPT_DEFAULT } from "@/lib/config"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  type ChatTurnAdapters,
  type ChatTurnMessage,
  createChatTurnController,
} from "./chat-turn"

function userMessage(
  id: string,
  text: string,
  createdAt = new Date("2026-01-01T00:00:00.000Z"),
  extraParts: NonNullable<ChatTurnMessage["parts"]> = []
): ChatTurnMessage {
  return {
    id,
    role: "user",
    createdAt,
    parts: [{ type: "text", text }, ...extraParts],
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

function createHarness() {
  let messages: ChatTurnMessage[] = []
  let isSending = false
  let pendingEdit: { message: ChatTurnMessage; chatId: string } | null = null
  const events: string[] = []
  const snapshots: string[][] = []

  const adapters: ChatTurnAdapters = {
    createOptimisticMessageId: vi.fn(() => "optimistic-message"),
    createOptimisticEditMessageId: vi.fn(() => "optimistic-edit-message"),
    getIsSending: vi.fn(() => isSending),
    setIsSending: vi.fn((value) => {
      isSending = value
      events.push(`setIsSending:${value}`)
    }),
    setIsSubmitting: vi.fn((value) => {
      events.push(`setIsSubmitting:${value}`)
    }),
    setHasSentFirstMessage: vi.fn((value) => {
      events.push(`setHasSentFirstMessage:${value}`)
    }),
    setMessages: vi.fn((action) => {
      events.push("setMessages")
      messages =
        typeof action === "function" ? action(messages) : [...action]
      snapshots.push(messages.map((message) => String(message.id)))
    }),
    resolveUserId: vi.fn(async () => {
      events.push("resolveUserId")
      return "user-1"
    }),
    checkLimitsAndNotify: vi.fn(async () => {
      events.push("checkLimitsAndNotify")
      return true
    }),
    ensureChatExists: vi.fn(async () => {
      events.push("ensureChatExists")
      return "chat-1"
    }),
    setPreviousChatId: vi.fn((chatId) => {
      events.push(`setPreviousChatId:${chatId}`)
    }),
    cleanupOptimisticAttachments: vi.fn(() => {
      events.push("cleanupOptimisticAttachments")
    }),
    handleFileUploads: vi.fn(async () => {
      events.push("handleFileUploads")
      return []
    }),
    sendMessage: vi.fn(() => {
      events.push("sendMessage")
    }),
    regenerate: vi.fn(() => {
      events.push("regenerate")
    }),
    routePersistsMessages: vi.fn((chatId) => {
      events.push(`routePersistsMessages:${chatId}`)
      return false
    }),
    cacheAndAddMessage: vi.fn(() => {
      events.push("cacheAndAddMessage")
    }),
    toastError: vi.fn((title) => {
      events.push(`toastError:${title}`)
    }),
    writeTrimmedMessages: vi.fn(async () => {
      events.push("writeTrimmedMessages")
    }),
    deleteMessagesFromTimestamp: vi.fn(async () => {
      events.push("deleteMessagesFromTimestamp")
    }),
    updateTitle: vi.fn(async () => {
      events.push("updateTitle")
    }),
    stagePendingEdit: vi.fn((message, chatId) => {
      pendingEdit = { message, chatId }
      events.push("stagePendingEdit")
    }),
    getPendingEdit: vi.fn(() => pendingEdit),
    clearPendingEdit: vi.fn(() => {
      pendingEdit = null
      events.push("clearPendingEdit")
    }),
    bumpChat: vi.fn(() => {
      events.push("bumpChat")
    }),
    setLastFinishReason: vi.fn((finishReason) => {
      events.push(`setLastFinishReason:${finishReason}`)
    }),
    getStoredGuestChatId: vi.fn(() => null),
    reconcileRecentMessages: vi.fn(async () => {
      events.push("reconcileRecentMessages")
    }),
    reportError: vi.fn((message) => {
      events.push(`reportError:${message}`)
    }),
  }

  return {
    adapters,
    controller: createChatTurnController(adapters),
    events,
    snapshots,
    getMessages: () => messages,
    setMessagesState: (nextMessages: ChatTurnMessage[]) => {
      messages = nextMessages
    },
    getPendingEdit: () => pendingEdit,
  }
}

describe("chat turn controller", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("runs a new send turn with optimistic state before checks and local persistence only for local routes", async () => {
    const local = createHarness()
    const onSuccess = vi.fn((chatId) => {
      local.events.push(`onSuccess:${chatId}`)
    })

    await local.controller.runSendTurn({
      text: "Hello",
      selectedModel: "model-1",
      isAuthenticated: false,
      bodyExtras: {
        systemPrompt: "custom system",
        enableSearch: true,
        chatVersion: 1,
      },
      onSuccess,
    })

    expect(local.snapshots[0]).toEqual(["optimistic-message"])
    expect(local.events.indexOf("setMessages")).toBeLessThan(
      local.events.indexOf("resolveUserId")
    )
    expect(local.adapters.sendMessage).toHaveBeenCalledWith(
      { text: "Hello", files: undefined },
      {
        body: {
          chatId: "chat-1",
          userId: "user-1",
          model: "model-1",
          isAuthenticated: false,
          systemPrompt: "custom system",
          enableSearch: true,
          chatVersion: 1,
        },
      }
    )
    expect(local.getMessages()).toEqual([])
    expect(local.adapters.cacheAndAddMessage).toHaveBeenCalledTimes(1)
    expect(onSuccess).toHaveBeenCalledWith("chat-1")

    const durable = createHarness()
    durable.adapters.routePersistsMessages = vi.fn(() => true)

    await durable.controller.runSendTurn({
      text: "Hello",
      selectedModel: "model-1",
      isAuthenticated: true,
    })

    expect(durable.adapters.sendMessage).toHaveBeenCalledTimes(1)
    expect(durable.adapters.cacheAndAddMessage).not.toHaveBeenCalled()
  })

  it("removes optimistic state and cleans optimistic attachment URLs when send is limit-denied", async () => {
    const { adapters, controller, getMessages } = createHarness()
    adapters.checkLimitsAndNotify = vi.fn(async () => false)

    await controller.runSendTurn({
      text: "Hello with file",
      selectedModel: "model-1",
      isAuthenticated: false,
      optimisticAttachments: [
        {
          name: "image.png",
          contentType: "image/png",
          url: "blob:local-image",
        },
      ],
    })

    expect(getMessages()).toEqual([])
    expect(adapters.sendMessage).not.toHaveBeenCalled()
    expect(adapters.cleanupOptimisticAttachments).toHaveBeenCalledWith([
      { url: "blob:local-image" },
    ])
  })

  it("runs suggestions through send behavior with the suggestion error message and chatVersion", async () => {
    const { adapters, controller } = createHarness()
    adapters.sendMessage = vi.fn(() => {
      throw new Error("send failed")
    })

    await controller.runSuggestionTurn({
      text: "Try this",
      selectedModel: "model-1",
      isAuthenticated: false,
      chatVersion: 4,
    })

    expect(adapters.sendMessage).toHaveBeenCalledWith(
      { text: "Try this", files: undefined },
      {
        body: {
          chatId: "chat-1",
          userId: "user-1",
          model: "model-1",
          isAuthenticated: false,
          systemPrompt: SYSTEM_PROMPT_DEFAULT,
          chatVersion: 4,
        },
      }
    )
    expect(adapters.toastError).toHaveBeenCalledWith(
      "Failed to send suggestion"
    )
  })

  it("runs edit resend after validation, preserving target file parts and staging the pending edit", async () => {
    const { adapters, controller, events, setMessagesState, snapshots } =
      createHarness()
    const targetCreatedAt = new Date("2026-01-02T00:00:00.000Z")
    const targetFile = {
      type: "file" as const,
      filename: "source.pdf",
      mediaType: "application/pdf",
      url: "https://files.test/source.pdf",
    }
    setMessagesState([
      userMessage("user-1", "old text", targetCreatedAt, [targetFile]),
      assistantMessage("assistant-1", "old answer"),
    ])

    await controller.runEditTurn({
      chatId: "chat-existing",
      messages: [
        userMessage("user-1", "old text", targetCreatedAt, [targetFile]),
        assistantMessage("assistant-1", "old answer"),
      ],
      messageId: "user-1",
      newContent: "new text",
      selectedModel: "model-1",
      isAuthenticated: true,
      systemPrompt: "custom system",
      enableSearch: true,
      isSubmitting: false,
      status: "ready",
    })

    expect(snapshots[0]).toEqual(["optimistic-edit-message"])
    expect(events.indexOf("ensureChatExists")).toBeLessThan(
      events.indexOf("writeTrimmedMessages")
    )
    expect(events.indexOf("writeTrimmedMessages")).toBeLessThan(
      events.indexOf("deleteMessagesFromTimestamp")
    )
    expect(adapters.writeTrimmedMessages).toHaveBeenCalledWith(
      "chat-existing",
      []
    )
    expect(adapters.deleteMessagesFromTimestamp).toHaveBeenCalledWith(
      targetCreatedAt.getTime(),
      1
    )
    expect(adapters.updateTitle).toHaveBeenCalledWith("chat-1", "new text")
    expect(adapters.sendMessage).toHaveBeenCalledWith(
      {
        text: "new text",
        files: [targetFile],
      },
      {
        body: {
          chatId: "chat-1",
          userId: "user-1",
          model: "model-1",
          isAuthenticated: true,
          systemPrompt: "custom system",
          enableSearch: true,
          chatVersion: 1,
        },
      }
    )
    expect(events.indexOf("sendMessage")).toBeLessThan(
      events.indexOf("stagePendingEdit")
    )
    expect(adapters.stagePendingEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "optimistic-edit-message",
        role: "user",
      }),
      "chat-1"
    )
    expect(adapters.bumpChat).toHaveBeenCalledWith("chat-1")
  })

  it("rolls back edit state and does not stage a pending edit when edit resend fails", async () => {
    const { adapters, controller, getMessages, setMessagesState } =
      createHarness()
    const originalMessages = [
      userMessage("user-1", "old text"),
      assistantMessage("assistant-1", "old answer"),
    ]
    setMessagesState(originalMessages)
    adapters.deleteMessagesFromTimestamp = vi.fn(async () => {
      throw new Error("delete failed")
    })

    await controller.runEditTurn({
      chatId: "chat-existing",
      messages: originalMessages,
      messageId: "user-1",
      newContent: "new text",
      selectedModel: "model-1",
      isAuthenticated: true,
      systemPrompt: "custom system",
      enableSearch: true,
      isSubmitting: false,
      status: "ready",
    })

    expect(getMessages()).toEqual(originalMessages)
    expect(adapters.sendMessage).not.toHaveBeenCalled()
    expect(adapters.stagePendingEdit).not.toHaveBeenCalled()
    expect(adapters.toastError).toHaveBeenCalledWith("Failed to apply edit")
  })

  it("regenerates with the existing request body and no optimistic user message", async () => {
    const { adapters, controller } = createHarness()

    await controller.runRegenerationTurn({
      chatId: "chat-1",
      selectedModel: "model-1",
      isAuthenticated: true,
      systemPrompt: "custom system",
      chatVersion: 2,
    })

    expect(adapters.regenerate).toHaveBeenCalledWith({
      body: {
        chatId: "chat-1",
        userId: "user-1",
        model: "model-1",
        isAuthenticated: true,
        systemPrompt: "custom system",
        chatVersion: 2,
      },
    })
    expect(adapters.setMessages).not.toHaveBeenCalled()
    expect(adapters.cleanupOptimisticAttachments).not.toHaveBeenCalled()
  })

  it("reconciles finish persistence for local, durable, and pending edit turns", async () => {
    const local = createHarness()
    const assistant = assistantMessage("assistant-new", "answer")

    await local.controller.finishChatTurn({
      message: assistant,
      isAbort: false,
      isDisconnect: false,
      isError: false,
      finishReason: "stop",
      chatId: "local-chat",
      previousChatId: null,
    })

    expect(local.adapters.setLastFinishReason).toHaveBeenCalledWith("stop")
    expect(local.adapters.cacheAndAddMessage).toHaveBeenCalledWith(
      assistant,
      "local-chat"
    )
    expect(local.adapters.reconcileRecentMessages).toHaveBeenCalledWith(
      "local-chat",
      2
    )

    const durable = createHarness()
    durable.adapters.routePersistsMessages = vi.fn(() => true)

    await durable.controller.finishChatTurn({
      message: assistant,
      isAbort: false,
      isDisconnect: false,
      isError: false,
      finishReason: "stop",
      chatId: "server-chat",
      previousChatId: null,
    })

    expect(durable.adapters.cacheAndAddMessage).not.toHaveBeenCalled()
    expect(durable.adapters.reconcileRecentMessages).toHaveBeenCalledWith(
      "server-chat",
      2
    )

    const pendingLocal = createHarness()
    pendingLocal.adapters.stagePendingEdit(
      userMessage("edited-user", "edited"),
      "local-chat"
    )

    await pendingLocal.controller.finishChatTurn({
      message: assistant,
      isAbort: false,
      isDisconnect: false,
      isError: true,
      finishReason: "error",
      chatId: "local-chat",
      previousChatId: null,
    })

    expect(pendingLocal.adapters.cacheAndAddMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: "edited-user" }),
      "local-chat"
    )
    expect(pendingLocal.adapters.reconcileRecentMessages).not.toHaveBeenCalled()

    const pendingDurable = createHarness()
    pendingDurable.adapters.routePersistsMessages = vi.fn(() => true)
    pendingDurable.adapters.stagePendingEdit(
      userMessage("edited-user", "edited"),
      "server-chat"
    )

    await pendingDurable.controller.finishChatTurn({
      message: assistant,
      isAbort: true,
      isDisconnect: false,
      isError: false,
      finishReason: "stop",
      chatId: "server-chat",
      previousChatId: null,
    })

    expect(pendingDurable.adapters.cacheAndAddMessage).not.toHaveBeenCalled()
    expect(pendingDurable.adapters.reconcileRecentMessages).not.toHaveBeenCalled()
  })
})
