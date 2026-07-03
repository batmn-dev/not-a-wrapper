import { createChatTurnStore } from "@/lib/chat-store/turns/chat-turn-service"
import { SYSTEM_PROMPT_DEFAULT } from "@/lib/config"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  createChatTurnController,
  type ChatTurnAdapters,
  type ChatTurnMessage,
  type ChatTurnSnapshot,
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
  let cachedMessages: ChatTurnMessage[] = []
  let isSending = false
  // The Turn context snapshot runners read at run time (adapters.getTurnSnapshot).
  let snapshot: ChatTurnSnapshot = {
    selectedModel: "model-1",
    isAuthenticated: false,
    systemPrompt: SYSTEM_PROMPT_DEFAULT,
    enableSearch: false,
  }
  let pendingEdit: { message: ChatTurnMessage; chatId: string } | null = null
  let routePersistsMessages = false
  const events: string[] = []
  const snapshots: string[][] = []

  const storeAdapters = {
    isAuthenticated: vi.fn(() => routePersistsMessages),
    updateMessages: vi.fn(
      (updater: (prev: ChatTurnMessage[]) => ChatTurnMessage[]) => {
        events.push("updateMessages")
        messages = updater(messages)
        snapshots.push(messages.map((message) => String(message.id)))
      }
    ),
    cacheAndAddMessage: vi.fn(() => {
      events.push("cacheAndAddMessage")
    }),
    updateTitle: vi.fn(async () => {
      events.push("updateTitle")
    }),
    pendingEdit: {
      stage: vi.fn((message: ChatTurnMessage, chatId: string) => {
        pendingEdit = { message, chatId }
        events.push("stagePendingEdit")
      }),
      get: vi.fn(() => pendingEdit),
      clear: vi.fn(() => {
        pendingEdit = null
        events.push("clearPendingEdit")
      }),
    },
    getStoredGuestChatId: vi.fn(() => null),
    readMessages: vi.fn(async () => cachedMessages),
    writeMessages: vi.fn(async (_chatId: string, nextMessages: ChatTurnMessage[]) => {
      cachedMessages = nextMessages
      events.push("writeTrimmedMessages")
    }),
    reportError: vi.fn((message: string) => {
      events.push(`reportError:${message}`)
    }),
  }

  const adapters: ChatTurnAdapters = {
    createOptimisticMessageId: vi.fn(() => "optimistic-message"),
    createOptimisticEditMessageId: vi.fn(() => "optimistic-edit-message"),
    getTurnSnapshot: vi.fn(() => snapshot),
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
      messages = typeof action === "function" ? action(messages) : [...action]
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
    toastError: vi.fn((title) => {
      events.push(`toastError:${title}`)
    }),
    bumpChat: vi.fn(() => {
      events.push("bumpChat")
    }),
    setLastFinishReason: vi.fn((finishReason) => {
      events.push(`setLastFinishReason:${finishReason}`)
    }),
    reportError: vi.fn((message) => {
      events.push(`reportError:${message}`)
    }),
    turnStore: createChatTurnStore(storeAdapters),
  }

  return {
    adapters,
    storeAdapters,
    controller: createChatTurnController(adapters),
    events,
    snapshots,
    getMessages: () => messages,
    setMessagesState: (nextMessages: ChatTurnMessage[]) => {
      messages = nextMessages
    },
    setCachedMessages: (nextMessages: ChatTurnMessage[]) => {
      cachedMessages = nextMessages
    },
    getPendingEdit: () => pendingEdit,
    setRoutePersistsMessages: (next: boolean) => {
      routePersistsMessages = next
    },
    setSnapshot: (next: Partial<ChatTurnSnapshot>) => {
      snapshot = { ...snapshot, ...next }
    },
    stagePendingEdit: storeAdapters.pendingEdit.stage,
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

    local.setSnapshot({ systemPrompt: "custom system", enableSearch: true })

    await local.controller.runSendTurn({
      text: "Hello",
      bodyExtras: {
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
          expectedVisibleMessageCount: 0,
        },
      }
    )
    expect(local.getMessages()).toEqual([])
    expect(local.storeAdapters.cacheAndAddMessage).toHaveBeenCalledTimes(1)
    expect(onSuccess).toHaveBeenCalledWith("chat-1")

    const durable = createHarness()
    durable.setRoutePersistsMessages(true)

    durable.setSnapshot({ isAuthenticated: true })
    await durable.controller.runSendTurn({
      text: "Hello",
    })

    expect(durable.adapters.sendMessage).toHaveBeenCalledTimes(1)
    expect(durable.storeAdapters.cacheAndAddMessage).not.toHaveBeenCalled()
  })

  it("removes optimistic state and cleans optimistic attachment URLs when send is limit-denied", async () => {
    const { adapters, controller, getMessages } = createHarness()
    adapters.checkLimitsAndNotify = vi.fn(async () => false)

    await controller.runSendTurn({
      text: "Hello with file",
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

  it("sends normal turns with the rendered selected-path server tail", async () => {
    const { adapters, controller, setSnapshot } = createHarness()
    setSnapshot({ isAuthenticated: true })
    const visibleMessages = [
      {
        ...userMessage("client-user-1", "prompt"),
        metadata: { serverMessageId: "message_user_1" },
      },
      {
        ...assistantMessage("client-assistant-1", "answer"),
        metadata: { serverMessageId: "message_assistant_1" },
      },
    ]

    await controller.runSendTurn({
      text: "next prompt",
      messages: visibleMessages,
    })

    expect(adapters.sendMessage).toHaveBeenCalledWith(
      { text: "next prompt", files: undefined },
      {
        body: expect.objectContaining({
          expectedVisibleMessageCount: 2,
          tailMessageId: "message_assistant_1",
        }),
      }
    )
  })

  it("runs suggestions through send behavior with the suggestion error message and chatVersion", async () => {
    const { adapters, controller } = createHarness()
    adapters.sendMessage = vi.fn(() => {
      throw new Error("send failed")
    })

    await controller.runSuggestionTurn({
      text: "Try this",
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
          // Suggestions now read the same Turn context snapshot as typed
          // sends, so enableSearch no longer silently diverges.
          enableSearch: false,
          chatVersion: 4,
          expectedVisibleMessageCount: 0,
        },
      }
    )
    expect(adapters.toastError).toHaveBeenCalledWith(
      "Failed to send suggestion"
    )
  })

  it("runs edit resend after validation, preserving target file parts and staging the pending edit", async () => {
    const {
      adapters,
      controller,
      events,
      setMessagesState,
      setSnapshot,
      snapshots,
      storeAdapters,
    } = createHarness()
    setSnapshot({
      isAuthenticated: true,
      systemPrompt: "custom system",
      enableSearch: true,
    })
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
      isSubmitting: false,
      status: "ready",
    })

    expect(snapshots[0]).toEqual(["optimistic-edit-message"])
    expect(events.indexOf("ensureChatExists")).toBeLessThan(
      events.indexOf("sendMessage")
    )
    expect(storeAdapters.writeMessages).not.toHaveBeenCalled()
    expect(adapters.sendMessage).toHaveBeenCalledWith(
      {
        text: "new text",
        files: [targetFile],
      },
      {
        body: expect.objectContaining({
          chatId: "chat-1",
          userId: "user-1",
          model: "model-1",
          isAuthenticated: true,
          systemPrompt: "custom system",
          enableSearch: true,
          chatVersion: 1,
          edit: expect.objectContaining({
            editedMessageId: "user-1",
            title: "new text",
          }),
        }),
      }
    )
    expect(events.indexOf("sendMessage")).toBeLessThan(
      events.indexOf("stagePendingEdit")
    )
    expect(storeAdapters.pendingEdit.stage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "optimistic-edit-message",
        role: "user",
      }),
      "chat-1"
    )
    expect(adapters.bumpChat).toHaveBeenCalledWith("chat-1")
  })

  it("restores visible messages when edit resend dispatch throws", async () => {
    const {
      adapters,
      controller,
      getMessages,
      setMessagesState,
      setSnapshot,
      storeAdapters,
    } = createHarness()
    setSnapshot({
      isAuthenticated: true,
      systemPrompt: "custom system",
      enableSearch: true,
    })
    const originalMessages = [
      userMessage("user-1", "old text"),
      assistantMessage("assistant-1", "old answer"),
      userMessage("user-2", "later text"),
      assistantMessage("assistant-2", "later answer"),
    ]
    setMessagesState(originalMessages)
    adapters.sendMessage = vi.fn(() => {
      throw new Error("send failed")
    })

    await controller.runEditTurn({
      chatId: "chat-existing",
      messages: originalMessages,
      messageId: "user-1",
      newContent: "new text",
      isSubmitting: false,
      status: "ready",
    })

    expect(getMessages()).toEqual(originalMessages)
    expect(adapters.sendMessage).toHaveBeenCalled()
    expect(storeAdapters.writeMessages).not.toHaveBeenCalled()
    expect(storeAdapters.pendingEdit.stage).not.toHaveBeenCalled()
    expect(adapters.toastError).toHaveBeenCalledWith("Failed to apply edit")
  })

  it("sends durable edit intent without client-side truncation before dispatch", async () => {
    const {
      adapters,
      controller,
      setMessagesState,
      setRoutePersistsMessages,
      setSnapshot,
      storeAdapters,
    } = createHarness()
    setRoutePersistsMessages(true)
    setSnapshot({
      isAuthenticated: true,
      systemPrompt: "custom system",
      enableSearch: true,
    })
    const targetCreatedAt = new Date("2026-01-02T00:00:00.000Z")
    const originalMessages = [
      userMessage("user-1", "old text", targetCreatedAt),
      assistantMessage("assistant-1", "old answer"),
      userMessage("user-2", "later text"),
      assistantMessage("assistant-2", "later answer"),
    ]
    setMessagesState(originalMessages)

    const result = await controller.runEditTurn({
      chatId: "server-chat",
      messages: originalMessages,
      messageId: "user-1",
      newContent: "new text",
      isSubmitting: false,
      status: "ready",
    })

    expect(result).toEqual({ ok: true })
    expect(storeAdapters.writeMessages).not.toHaveBeenCalled()
    expect(adapters.sendMessage).toHaveBeenCalledWith(
      {
        text: "new text",
        files: undefined,
      },
      {
        body: expect.objectContaining({
          chatId: "chat-1",
          userId: "user-1",
          model: "model-1",
          isAuthenticated: true,
          systemPrompt: "custom system",
          enableSearch: true,
          chatVersion: 1,
          edit: {
            editedMessageId: "user-1",
            editCutoffTimestamp: targetCreatedAt.getTime(),
            expectedChatVersion: 4,
            replacementMessage: expect.objectContaining({
              id: "optimistic-edit-message",
              role: "user",
              content: "new text",
            }),
            title: "new text",
          },
        }),
      }
    )
    expect(storeAdapters.pendingEdit.stage).toHaveBeenCalled()
  })

  it("accepts AI SDK client message IDs in durable edit intents", async () => {
    const {
      adapters,
      controller,
      setMessagesState,
      setRoutePersistsMessages,
      setSnapshot,
    } = createHarness()
    setRoutePersistsMessages(true)
    setSnapshot({ isAuthenticated: true, systemPrompt: "custom system" })
    const targetCreatedAt = new Date("2026-01-02T00:00:00.000Z")
    const clientMessageId = "msg-client-123"
    const originalMessages = [
      userMessage(clientMessageId, "old text", targetCreatedAt),
      assistantMessage("assistant-1", "old answer"),
    ]
    setMessagesState(originalMessages)

    const result = await controller.runEditTurn({
      chatId: "server-chat",
      messages: originalMessages,
      messageId: clientMessageId,
      newContent: "new text",
      isSubmitting: false,
      status: "ready",
    })

    expect(result).toEqual({ ok: true })
    expect(adapters.sendMessage).toHaveBeenCalledWith(
      { text: "new text", files: undefined },
      {
        body: expect.objectContaining({
          edit: expect.objectContaining({
            editedMessageId: clientMessageId,
            editCutoffTimestamp: targetCreatedAt.getTime(),
          }),
        }),
      }
    )
  })

  it("blocks edit while generation is active without closing the draft lifecycle", async () => {
    const { adapters, controller, setSnapshot } = createHarness()
    setSnapshot({ isAuthenticated: true })
    const result = await controller.runEditTurn({
      chatId: "server-chat",
      messages: [userMessage("user-1", "old text")],
      messageId: "user-1",
      newContent: "new text",
      isSubmitting: false,
      status: "streaming",
    })

    expect(result).toEqual({
      ok: false,
      reason: "generation-active",
      message: "Please wait until the current message finishes sending.",
    })
    expect(adapters.sendMessage).not.toHaveBeenCalled()
    expect(adapters.setMessages).not.toHaveBeenCalled()
    expect(adapters.toastError).toHaveBeenCalledWith(
      "Please wait until the current message finishes sending."
    )
  })

  it("refuses edit on a non-durable chat", async () => {
    const { adapters, controller } = createHarness()
    const result = await controller.runEditTurn({
      chatId: "local-chat",
      messages: [userMessage("user-1", "old text")],
      messageId: "user-1",
      newContent: "new text",
      isSubmitting: false,
      status: "ready",
    })

    expect(result).toEqual({
      ok: false,
      reason: "not-durable",
      message:
        "Editing is available once the chat is saved. Sign in to edit messages.",
    })
    expect(adapters.sendMessage).not.toHaveBeenCalled()
    expect(adapters.setMessages).not.toHaveBeenCalled()
  })

  it("regenerates with a target message id and explicit intent", async () => {
    const { adapters, controller, setMessagesState, setSnapshot, storeAdapters } =
      createHarness()
    setSnapshot({ isAuthenticated: true, systemPrompt: "custom system" })
    const targetCreatedAt = new Date("2026-01-02T00:00:00.000Z")
    const messages = [
      userMessage("user-1", "prompt"),
      assistantMessage("assistant-1", "old answer", targetCreatedAt),
    ]
    setMessagesState(messages)

    await controller.runRegenerationTurn({
      chatId: "chat-1",
      messages,
      targetAssistantMessageId: "assistant-1",
      chatVersion: 2,
      isSubmitting: false,
      status: "ready",
    })

    expect(adapters.regenerate).toHaveBeenCalledWith({
      messageId: "assistant-1",
      body: {
        chatId: "chat-1",
        userId: "user-1",
        model: "model-1",
        isAuthenticated: true,
        systemPrompt: "custom system",
        // Regeneration reads the same Turn context snapshot as sends, so the
        // request now carries the search enablement uniformly.
        enableSearch: false,
        chatVersion: 2,
        regeneration: {
          targetAssistantMessageId: "assistant-1",
          targetAssistantCreatedAt: targetCreatedAt.getTime(),
          expectedChatVersion: 2,
          precedingUserMessageId: "user-1",
        },
      },
    })
    expect(adapters.setMessages).not.toHaveBeenCalled()
    expect(adapters.cleanupOptimisticAttachments).not.toHaveBeenCalled()
    expect(storeAdapters.writeMessages).not.toHaveBeenCalled()
  })

  it("stages durable regeneration without local cache mutation", async () => {
    const {
      adapters,
      controller,
      setMessagesState,
      setRoutePersistsMessages,
      setSnapshot,
      storeAdapters,
    } = createHarness()
    setRoutePersistsMessages(true)
    setSnapshot({ isAuthenticated: true, systemPrompt: "custom system" })
    const targetCreatedAt = new Date("2026-01-02T00:00:00.000Z")
    const messages = [
      userMessage("user-1", "prompt"),
      assistantMessage("assistant-1", "old answer", targetCreatedAt),
    ]
    setMessagesState(messages)

    await controller.runRegenerationTurn({
      chatId: "server-chat",
      messages,
      targetAssistantMessageId: "assistant-1",
      chatVersion: 2,
      isSubmitting: false,
      status: "ready",
    })

    expect(storeAdapters.writeMessages).not.toHaveBeenCalled()
    expect(storeAdapters.cacheAndAddMessage).not.toHaveBeenCalled()
    expect(adapters.regenerate).toHaveBeenCalledWith({
      messageId: "assistant-1",
      body: expect.objectContaining({
        chatId: "server-chat",
        regeneration: {
          targetAssistantMessageId: "assistant-1",
          targetAssistantCreatedAt: targetCreatedAt.getTime(),
          expectedChatVersion: 2,
          precedingUserMessageId: "user-1",
        },
      }),
    })
  })

  it("refuses regeneration while another generation is active", async () => {
    const { adapters, controller, setMessagesState, setSnapshot } =
      createHarness()
    setSnapshot({ isAuthenticated: true })
    const messages = [
      userMessage("user-1", "prompt"),
      assistantMessage("assistant-1", "old answer"),
      userMessage("user-2", "next prompt"),
    ]
    setMessagesState(messages)

    await controller.runRegenerationTurn({
      chatId: "chat-1",
      messages,
      targetAssistantMessageId: "assistant-1",
      chatVersion: 3,
      isSubmitting: false,
      status: "streaming",
    })

    expect(adapters.regenerate).not.toHaveBeenCalled()
    expect(adapters.resolveUserId).not.toHaveBeenCalled()
    expect(adapters.toastError).toHaveBeenCalledWith(
      "Please wait until the current message finishes sending."
    )
  })

  it("refuses regeneration on a non-durable chat", async () => {
    const { adapters, controller, setMessagesState, storeAdapters } =
      createHarness()
    const messages = [
      userMessage("user-1", "prompt"),
      assistantMessage("assistant-1", "old answer"),
    ]
    setMessagesState(messages)

    await controller.runRegenerationTurn({
      chatId: "local-chat",
      messages,
      targetAssistantMessageId: "assistant-1",
      chatVersion: 2,
      isSubmitting: false,
      status: "ready",
    })

    expect(adapters.regenerate).not.toHaveBeenCalled()
    expect(adapters.setMessages).not.toHaveBeenCalled()
    expect(storeAdapters.writeMessages).not.toHaveBeenCalled()
    expect(storeAdapters.cacheAndAddMessage).not.toHaveBeenCalled()
    expect(adapters.toastError).toHaveBeenCalledWith(
      "Regenerating is available once the chat is saved."
    )
  })

  it("persists finish for local, durable, and pending edit turns", async () => {
    // Identity adoption is owned by the branch projection seam; finishChatTurn
    // persists (or skips, when the route persists) and records the finish
    // reason, but does not patch live message ids.
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
    expect(local.storeAdapters.cacheAndAddMessage).toHaveBeenCalledWith(
      assistant,
      "local-chat"
    )

    const durable = createHarness()
    durable.setRoutePersistsMessages(true)

    await durable.controller.finishChatTurn({
      message: assistant,
      isAbort: false,
      isDisconnect: false,
      isError: false,
      finishReason: "stop",
      chatId: "server-chat",
      previousChatId: null,
    })

    expect(durable.storeAdapters.cacheAndAddMessage).not.toHaveBeenCalled()

    const pendingLocal = createHarness()
    pendingLocal.stagePendingEdit(
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

    expect(pendingLocal.storeAdapters.cacheAndAddMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: "edited-user" }),
      "local-chat"
    )

    const pendingDurable = createHarness()
    pendingDurable.setRoutePersistsMessages(true)
    pendingDurable.stagePendingEdit(
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

    expect(
      pendingDurable.storeAdapters.cacheAndAddMessage
    ).not.toHaveBeenCalled()
  })
})
