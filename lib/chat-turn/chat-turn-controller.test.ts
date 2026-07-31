import { SYSTEM_PROMPT_DEFAULT } from "@/lib/config"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  createChatTurnController,
  type ChatTurnAdapters,
  type ChatTurnMessage,
  type ChatTurnSnapshot,
  type EnsuredTurnChat,
} from "./chat-turn-controller"
import { assistantMessage, userMessage } from "./fixtures"

function createHarness() {
  let messages: ChatTurnMessage[] = []
  let cachedMessages: ChatTurnMessage[] = []
  let isSending = false
  let currentChatId: string | null = "chat-1"
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
    writeMessages: vi.fn(
      async (_chatId: string, nextMessages: ChatTurnMessage[]) => {
        cachedMessages = nextMessages
        events.push("writeTrimmedMessages")
      }
    ),
    reportError: vi.fn((message: string) => {
      events.push(`reportError:${message}`)
    }),
  }

  const adapters: ChatTurnAdapters = {
    createOptimisticMessageId: vi.fn(() => "optimistic-message"),
    createOptimisticEditMessageId: vi.fn(() => "optimistic-edit-message"),
    getTurnSnapshot: vi.fn(() => snapshot),
    getCurrentChatId: vi.fn(() => currentChatId),
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
      return { chatId: "chat-1" }
    }),
    setPreviousChatId: vi.fn((chatId) => {
      events.push(`setPreviousChatId:${chatId}`)
    }),
    cleanupOptimisticAttachments: vi.fn(() => {
      events.push("cleanupOptimisticAttachments")
    }),
    attachStagedFiles: vi.fn(async () => {
      events.push("attachStagedFiles")
      return []
    }),
    sendMessage: vi.fn(() => {
      events.push("sendMessage")
    }),
    sendMessageAndWaitForAcceptance: vi.fn(
      (...args: Parameters<ChatTurnAdapters["sendMessage"]>) =>
        Promise.resolve(adapters.sendMessage(...args))
    ),
    regenerate: vi.fn(() => {
      events.push("regenerate")
    }),
    onLocalDispatch: vi.fn(),
    resetLocalStopIntent: vi.fn(),
    consumeLocalStopIntent: vi.fn(() => false),
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
    store: storeAdapters,
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
    setCurrentChatId: (nextChatId: string | null) => {
      currentChatId = nextChatId
    },
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

  it("creates optimistic state before admission and locally persists only local routes", async () => {
    const local = createHarness()
    const onSuccess = vi.fn((chatId) => {
      local.events.push(`onSuccess:${chatId}`)
    })

    local.setSnapshot({ systemPrompt: "custom system", enableSearch: true })

    await local.controller.runSendTurn({
      text: "Hello",
      chatVersion: 1,
      onSuccess,
    })

    expect(local.snapshots[0]).toEqual(["optimistic-message"])
    expect(local.events.indexOf("setMessages")).toBeLessThan(
      local.events.indexOf("resolveUserId")
    )
    expect(local.events.indexOf("setMessages")).toBeLessThan(
      local.events.indexOf("checkLimitsAndNotify")
    )
    expect(local.events.indexOf("setMessages")).toBeLessThan(
      local.events.indexOf("ensureChatExists")
    )
    const optimisticMessage = local.getMessages()[0]
    expect(optimisticMessage?.createdAt).toBeInstanceOf(Date)
    expect(local.adapters.sendMessage).toHaveBeenCalledWith(
      {
        id: "optimistic-message",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
        createdAt: optimisticMessage?.createdAt,
        messageId: "optimistic-message",
      },
      {
        body: {
          chatId: "chat-1",
          userId: "user-1",
          model: "model-1",
          systemPrompt: "custom system",
          enableSearch: true,
          chatVersion: 1,
          expectedVisibleMessageCount: 0,
        },
      }
    )
    // The SDK replaces this row by messageId instead of removing/appending it;
    // the exact Date identity survives into the dispatched live message.
    expect(local.snapshots).toEqual([["optimistic-message"]])
    expect(local.getMessages()).toEqual([optimisticMessage])
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

  it("rolls back the immediate optimistic state when send is limit-denied", async () => {
    const { adapters, controller, getMessages } = createHarness()
    let resolveLimit!: (allowed: boolean) => void
    adapters.checkLimitsAndNotify = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveLimit = resolve
        })
    )

    const turn = controller.runSendTurn({
      text: "Hello with file",
      optimisticAttachments: [
        {
          name: "image.png",
          contentType: "image/png",
          url: "blob:local-image",
        },
      ],
    })

    await vi.waitFor(() =>
      expect(getMessages()).toEqual([
        expect.objectContaining({
          id: "optimistic-message",
          parts: expect.arrayContaining([
            expect.objectContaining({ url: "blob:local-image" }),
          ]),
        }),
      ])
    )
    resolveLimit(false)
    await turn

    expect(getMessages()).toEqual([])
    expect(adapters.setMessages).toHaveBeenCalledTimes(2)
    expect(adapters.sendMessage).not.toHaveBeenCalled()
    expect(adapters.cleanupOptimisticAttachments).not.toHaveBeenCalled()
  })

  it("atomically hands off the optimistic timestamp and uploaded attachment parts", async () => {
    const { adapters, controller, getMessages, snapshots, storeAdapters } =
      createHarness()
    adapters.attachStagedFiles = vi.fn(async () => [
      {
        name: "notes.pdf",
        contentType: "application/pdf",
        url: "https://files.test/notes.pdf",
        attachmentId: "attachment-1",
      },
    ])

    await controller.runSendTurn({
      text: "Read this",
      submittedFiles: [{} as File],
      submittedAttachments: [
        {
          attachmentId: "attachment-1",
        },
      ],
      optimisticAttachments: [
        {
          name: "notes.pdf",
          contentType: "application/pdf",
          url: "blob:local-notes",
        },
      ],
    })

    const optimisticMessage = getMessages()[0]
    const dispatchedMessage = vi.mocked(adapters.sendMessage).mock.calls[0]?.[0]
    // First paint uses the staged preview; admission reconciles canonical
    // attachment URLs in place under the same stable row identity.
    expect(snapshots).toEqual([
      ["optimistic-message"],
      ["optimistic-message"],
    ])
    expect(adapters.attachStagedFiles).toHaveBeenCalledWith("chat-1", [
      "attachment-1",
    ])
    expect(dispatchedMessage).toEqual({
      id: "optimistic-message",
      role: "user",
      createdAt: optimisticMessage?.createdAt,
      messageId: "optimistic-message",
      parts: [
        { type: "text", text: "Read this" },
        {
          type: "file",
          filename: "notes.pdf",
          mediaType: "application/pdf",
          url: "https://files.test/notes.pdf",
          attachmentId: "attachment-1",
        },
      ],
    })
    expect(adapters.cleanupOptimisticAttachments).not.toHaveBeenCalled()
    expect(storeAdapters.cacheAndAddMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "optimistic-message",
        createdAt: optimisticMessage?.createdAt,
        parts: expect.arrayContaining([
          expect.objectContaining({ url: "https://files.test/notes.pdf" }),
        ]),
      }),
      "chat-1"
    )
  })

  it("keeps an accepted turn accepted when local persistence throws synchronously", async () => {
    const { adapters, controller, getMessages, storeAdapters } = createHarness()
    const persistenceError = new Error("IndexedDB unavailable")
    const onSuccess = vi.fn()
    storeAdapters.cacheAndAddMessage.mockImplementation(() => {
      throw persistenceError
    })

    await controller.runSendTurn({
      text: "Keep this accepted turn",
      onSuccess,
    })

    expect(getMessages()).toEqual([
      expect.objectContaining({
        id: "optimistic-message",
        role: "user",
      }),
    ])
    expect(onSuccess).toHaveBeenCalledWith("chat-1")
    expect(adapters.toastError).not.toHaveBeenCalled()
    expect(adapters.reportError).toHaveBeenCalledWith(
      "Failed to persist accepted user message:",
      persistenceError
    )
  })

  it("reports and rejects an attachment without a staged attachment id", async () => {
    const { adapters, controller, getMessages } = createHarness()

    await controller.runSendTurn({
      text: "Read this",
      submittedFiles: [{} as File],
      submittedAttachments: [
        {
          name: "notes.pdf",
          contentType: "application/pdf",
          url: "/api/files/notes/preview",
        },
      ],
    })

    expect(adapters.toastError).toHaveBeenCalledWith("Failed to send message")
    expect(adapters.attachStagedFiles).not.toHaveBeenCalled()
    // The incomplete set rejects BEFORE allocation, so an atomic first turn
    // can never commit a chat around references it cannot bind.
    expect(adapters.ensureChatExists).not.toHaveBeenCalled()
    expect(getMessages()).toEqual([])
    expect(adapters.setMessages).not.toHaveBeenCalled()
    expect(adapters.sendMessage).not.toHaveBeenCalled()
  })

  it.each([
    { outcome: "null", bindingResult: null },
    {
      outcome: "partial",
      bindingResult: [
        {
          name: "one.pdf",
          contentType: "application/pdf",
          url: "https://files.test/one.pdf",
          attachmentId: "one",
        },
      ],
    },
  ])(
    "reports and rejects staged binding when the result is $outcome",
    async ({ bindingResult }) => {
      const { adapters, controller, getMessages } = createHarness()
      adapters.attachStagedFiles = vi.fn(async () => bindingResult)

      await controller.runSendTurn({
        text: "Read both",
        submittedFiles: [{} as File, {} as File],
        submittedAttachments: [
          {
            name: "one.pdf",
            contentType: "application/pdf",
            url: "/api/files/one/preview",
            attachmentId: "one",
          },
          {
            name: "two.pdf",
            contentType: "application/pdf",
            url: "/api/files/two/preview",
            attachmentId: "two",
          },
        ],
      })

      expect(adapters.toastError).toHaveBeenCalledWith("Failed to send message")
      expect(getMessages()).toEqual([])
      expect(adapters.setMessages).toHaveBeenCalledTimes(2)
      expect(adapters.sendMessage).not.toHaveBeenCalled()
    }
  )

  it("dispatches an atomic first turn against its server-persisted message", async () => {
    const { adapters, controller, setSnapshot } = createHarness()
    setSnapshot({ isAuthenticated: true })
    const boundAttachment = {
      name: "notes.pdf",
      contentType: "application/pdf",
      url: "https://files.test/notes.pdf",
      attachmentId: "attachment-1",
    }
    const confirmDispatched = vi.fn()
    adapters.ensureChatExists = vi.fn(async (args) => {
      // The atomic creation receives the optimistic id as the durable row's
      // clientMessageId and the complete staged set to bind.
      expect(args).toEqual({
        userId: "user-1",
        text: "Read this",
        clientMessageId: "optimistic-message",
        attachmentIds: ["attachment-1"],
      })
      return {
        chatId: "chat-new",
        firstTurn: {
          userMessageId: "message_user_1",
          clientMessageId: "optimistic-message",
          attachments: [boundAttachment],
          confirmDispatched,
        },
      }
    })

    await controller.runSendTurn({
      text: "Read this",
      submittedFiles: [{} as File],
      submittedAttachments: [{ attachmentId: "attachment-1" }],
    })

    // The atomic creation already bound the set; a second binding call would
    // race the dispatch and could double-bind on retries.
    expect(adapters.attachStagedFiles).not.toHaveBeenCalled()
    expect(adapters.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "optimistic-message",
        parts: [
          { type: "text", text: "Read this" },
          {
            type: "file",
            filename: "notes.pdf",
            mediaType: "application/pdf",
            url: "https://files.test/notes.pdf",
            attachmentId: "attachment-1",
          },
        ],
      }),
      {
        // The token states the server fact (one persisted visible message),
        // not the client's still-empty rendered array.
        body: expect.objectContaining({
          chatId: "chat-new",
          expectedVisibleMessageCount: 1,
          tailMessageId: "message_user_1",
        }),
      }
    )
    // Acceptance consumes the committed identity exactly once.
    expect(confirmDispatched).toHaveBeenCalledTimes(1)
  })

  it("retries a committed first turn under the ORIGINAL persisted identity", async () => {
    // The regression this pins: after an atomic commit whose dispatch failed,
    // the retry allocates a fresh optimistic id — dispatching under it would
    // either duplicate the prompt or trip the stale-token guard. The provider
    // re-presents the committed identity; the runner must adopt it wholesale.
    const { adapters, controller, getMessages, setSnapshot } = createHarness()
    setSnapshot({ isAuthenticated: true })
    adapters.ensureChatExists = vi.fn(async () => ({
      chatId: "chat-new",
      firstTurn: {
        userMessageId: "message_user_1",
        clientMessageId: "committed-optimistic-id",
        attachments: [],
      },
    }))

    await controller.runSendTurn({ text: "Hello" })

    const dispatched = vi.mocked(adapters.sendMessage).mock.calls[0]
    expect(dispatched?.[0]).toMatchObject({
      id: "committed-optimistic-id",
      messageId: "committed-optimistic-id",
    })
    expect(dispatched?.[1]).toEqual({
      body: expect.objectContaining({
        expectedVisibleMessageCount: 1,
        tailMessageId: "message_user_1",
      }),
    })
    // The optimistic row also carries the committed identity, so the
    // projection reconciles it against the persisted row.
    expect(getMessages()[0]?.id).toBe("committed-optimistic-id")
    // No confirmDispatched provided (test fake) — the runner tolerates that.
  })

  it("does not consume the committed identity when dispatch throws", async () => {
    const { adapters, controller, setSnapshot } = createHarness()
    setSnapshot({ isAuthenticated: true })
    const confirmDispatched = vi.fn()
    adapters.ensureChatExists = vi.fn(async () => ({
      chatId: "chat-new",
      firstTurn: {
        userMessageId: "message_user_1",
        clientMessageId: "optimistic-message",
        attachments: [],
        confirmDispatched,
      },
    }))
    adapters.sendMessage = vi.fn(() => {
      throw new Error("send failed")
    })

    await controller.runSendTurn({ text: "Hello" })

    // A failed dispatch must leave the committed identity available for the
    // retry to claim.
    expect(confirmDispatched).not.toHaveBeenCalled()
    expect(adapters.toastError).toHaveBeenCalledWith("Failed to send message")
  })

  it("retains the committed identity when request acceptance fails asynchronously", async () => {
    const { adapters, controller, getMessages, setSnapshot } = createHarness()
    setSnapshot({ isAuthenticated: true })
    const confirmDispatched = vi.fn()
    adapters.ensureChatExists = vi.fn(async () => ({
      chatId: "chat-new",
      firstTurn: {
        userMessageId: "message_user_1",
        clientMessageId: "optimistic-message",
        attachments: [],
        confirmDispatched,
      },
    }))
    adapters.sendMessageAndWaitForAcceptance = vi.fn(async () => {
      await Promise.resolve()
      throw new TypeError("network connection lost")
    })

    await controller.runSendTurn({ text: "Hello" })

    expect(confirmDispatched).not.toHaveBeenCalled()
    expect(getMessages()).toEqual([])
    expect(adapters.toastError).toHaveBeenCalledWith("Failed to send message")
  })

  it("accepts an explicitly stopped turn when local abort races request acceptance", async () => {
    const { adapters, controller, getMessages, setSnapshot } = createHarness()
    setSnapshot({ isAuthenticated: true })
    const confirmDispatched = vi.fn()
    const onSuccess = vi.fn()
    adapters.ensureChatExists = vi.fn(async () => ({
      chatId: "chat-new",
      firstTurn: {
        userMessageId: "message_user_1",
        clientMessageId: "stopped-message",
        attachments: [],
        confirmDispatched,
      },
    }))
    adapters.sendMessageAndWaitForAcceptance = vi.fn(async () => {
      throw new DOMException("The operation was aborted", "AbortError")
    })
    adapters.consumeLocalStopIntent = vi
      .fn()
      .mockReturnValueOnce(true)
      .mockReturnValue(false)

    await controller.runSendTurn({
      text: "Stop this turn",
      onSuccess,
    })

    expect(getMessages()).toEqual([
      expect.objectContaining({ id: "stopped-message", role: "user" }),
    ])
    expect(confirmDispatched).toHaveBeenCalledTimes(1)
    expect(adapters.setHasSentFirstMessage).toHaveBeenCalledWith(true)
    expect(onSuccess).toHaveBeenCalledWith("chat-new")
    expect(adapters.toastError).not.toHaveBeenCalled()
  })

  it("accepts a first turn stopped during chat creation without dispatching a generation", async () => {
    const {
      adapters,
      controller,
      getMessages,
      setCurrentChatId,
      setSnapshot,
    } = createHarness()
    setSnapshot({ isAuthenticated: true })
    setCurrentChatId(null)
    const confirmDispatched = vi.fn()
    const onSuccess = vi.fn()
    let resolveChat!: (chat: EnsuredTurnChat) => void
    adapters.ensureChatExists = vi.fn(
      () =>
        new Promise<EnsuredTurnChat>((resolve) => {
          resolveChat = resolve
        })
    )
    let stopRequested = false
    adapters.resetLocalStopIntent = vi.fn(() => {
      stopRequested = false
    })
    adapters.consumeLocalStopIntent = vi.fn(() => {
      const requested = stopRequested
      stopRequested = false
      return requested
    })

    const turn = controller.runSendTurn({
      text: "Stop before dispatch",
      onSuccess,
    })
    await vi.waitFor(() =>
      expect(adapters.ensureChatExists).toHaveBeenCalledTimes(1)
    )
    expect(getMessages()).toEqual([
      expect.objectContaining({
        id: "optimistic-message",
        role: "user",
      }),
    ])
    expect(adapters.setIsSubmitting).toHaveBeenCalledWith(true)
    expect(adapters.sendMessageAndWaitForAcceptance).not.toHaveBeenCalled()

    stopRequested = true
    resolveChat({
      chatId: "chat-new",
      firstTurn: {
        userMessageId: "message_user_1",
        clientMessageId: "stopped-before-dispatch",
        attachments: [],
        confirmDispatched,
      },
    })
    await turn

    expect(getMessages()).toEqual([
      expect.objectContaining({
        id: "stopped-before-dispatch",
        role: "user",
      }),
    ])
    expect(adapters.onLocalDispatch).not.toHaveBeenCalled()
    expect(adapters.sendMessageAndWaitForAcceptance).not.toHaveBeenCalled()
    expect(confirmDispatched).toHaveBeenCalledTimes(1)
    expect(onSuccess).toHaveBeenCalledWith("chat-new")
    expect(adapters.toastError).not.toHaveBeenCalled()
  })

  it("reuses the original identity after an ambiguous claimed-then-disconnected request", async () => {
    const { adapters, controller, setSnapshot } = createHarness()
    setSnapshot({ isAuthenticated: true })
    const confirmDispatched = vi.fn()
    adapters.createOptimisticMessageId = vi
      .fn()
      .mockReturnValueOnce("fresh-attempt-1")
      .mockReturnValueOnce("fresh-attempt-2")
    adapters.ensureChatExists = vi.fn(async () => ({
      chatId: "chat-new",
      firstTurn: {
        userMessageId: "message_user_1",
        // The provider re-presents the atomically committed identity on both
        // attempts, even though each runner allocated a fresh local id.
        clientMessageId: "committed-first-turn",
        attachments: [],
        confirmDispatched,
      },
    }))
    adapters.sendMessageAndWaitForAcceptance = vi
      .fn()
      // The server may already have claimed the row; losing the response is
      // ambiguous, so retaining and retrying the same id is the safe action.
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(undefined)

    await controller.runSendTurn({ text: "Same prompt" })
    await controller.runSendTurn({ text: "Same prompt" })

    const dispatchedIds = vi
      .mocked(adapters.sendMessageAndWaitForAcceptance)
      .mock.calls.map(([message]) =>
        "messageId" in message ? message.messageId : undefined
      )
    expect(dispatchedIds).toEqual([
      "committed-first-turn",
      "committed-first-turn",
    ])
    expect(confirmDispatched).toHaveBeenCalledTimes(1)
  })

  it("consumes first-turn identity once request acceptance is acknowledged", async () => {
    const { adapters, controller, setSnapshot } = createHarness()
    setSnapshot({ isAuthenticated: true })
    const confirmDispatched = vi.fn()
    adapters.ensureChatExists = vi.fn(async () => ({
      chatId: "chat-new",
      firstTurn: {
        userMessageId: "message_user_1",
        clientMessageId: "optimistic-message",
        attachments: [],
        confirmDispatched,
      },
    }))
    let acknowledge!: () => void
    adapters.sendMessageAndWaitForAcceptance = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          acknowledge = resolve
        })
    )

    const turn = controller.runSendTurn({ text: "Hello" })
    await vi.waitFor(() =>
      expect(adapters.sendMessageAndWaitForAcceptance).toHaveBeenCalledTimes(1)
    )
    expect(confirmDispatched).not.toHaveBeenCalled()

    acknowledge()
    await turn

    expect(confirmDispatched).toHaveBeenCalledTimes(1)
  })

  it("rolls back optimistic state when no user id resolves", async () => {
    // The Composer restores the payload on a rejected turn — a lingering
    // optimistic bubble would show the text twice (and leak its blob: URLs).
    const { adapters, controller, getMessages } = createHarness()
    adapters.resolveUserId = vi.fn(async () => null)

    await controller.runSendTurn({
      text: "Hello without a user",
      optimisticAttachments: [
        {
          name: "image.png",
          contentType: "image/png",
          url: "blob:local-image",
        },
      ],
    })

    expect(getMessages()).toEqual([])
    expect(adapters.toastError).toHaveBeenCalledWith(
      "Could not start your session. Please try again."
    )
    expect(adapters.sendMessage).not.toHaveBeenCalled()
    expect(adapters.cleanupOptimisticAttachments).not.toHaveBeenCalled()
  })

  it("releases the send guard when the optimistic insert throws", async () => {
    const { adapters, controller } = createHarness()
    vi.mocked(adapters.setMessages).mockImplementationOnce(() => {
      throw new Error("render store unavailable")
    })

    await controller.runSendTurn({ text: "Hello" })

    expect(adapters.toastError).toHaveBeenCalledWith("Failed to send message")
    expect(adapters.setIsSending).toHaveBeenLastCalledWith(false)
    expect(adapters.setIsSubmitting).toHaveBeenLastCalledWith(false)
    expect(adapters.sendMessage).not.toHaveBeenCalled()

    // The guard was not left armed: the next send dispatches normally.
    await controller.runSendTurn({ text: "Hello again" })
    expect(adapters.sendMessage).toHaveBeenCalledTimes(1)
  })

  it("keeps an accepted turn accepted when onSuccess throws", async () => {
    const { adapters, controller, getMessages } = createHarness()
    const callbackError = new Error("sidebar bump failed")
    const onSuccess = vi.fn(() => {
      throw callbackError
    })

    await controller.runSendTurn({ text: "Keep accepted", onSuccess })

    expect(getMessages()).toEqual([
      expect.objectContaining({ id: "optimistic-message", role: "user" }),
    ])
    expect(adapters.toastError).not.toHaveBeenCalled()
    expect(adapters.reportError).toHaveBeenCalledWith(
      "Accepted-turn onSuccess callback failed:",
      callbackError
    )
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
      expect.objectContaining({
        id: "optimistic-message",
        role: "user",
        parts: [{ type: "text", text: "next prompt" }],
        createdAt: expect.any(Date),
        messageId: "optimistic-message",
      }),
      {
        body: expect.objectContaining({
          expectedVisibleMessageCount: 2,
          tailMessageId: "message_assistant_1",
        }),
      }
    )
  })

  it("rejects against the selected model's effective input budget before side effects", async () => {
    const { adapters, controller, setSnapshot } = createHarness()
    setSnapshot({ selectedModel: "gemma-3-27b-it" })
    const optimisticAttachments = [
      {
        name: "image.png",
        contentType: "image/png",
        url: "blob:local-image",
      },
    ]

    await controller.runSendTurn({
      text: "x".repeat(30_000),
      optimisticAttachments,
    })

    expect(adapters.toastError).toHaveBeenCalledWith(
      "This prompt is too long for Gemma 3 27B. Shorten the message or remove attachments."
    )
    expect(adapters.cleanupOptimisticAttachments).toHaveBeenCalledWith(
      optimisticAttachments
    )
    expect(adapters.ensureChatExists).not.toHaveBeenCalled()
    expect(adapters.setMessages).not.toHaveBeenCalled()
    expect(adapters.sendMessage).not.toHaveBeenCalled()
    expect(adapters.setIsSending).not.toHaveBeenCalled()
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
      expect.objectContaining({
        id: "optimistic-message",
        role: "user",
        parts: [{ type: "text", text: "Try this" }],
        createdAt: expect.any(Date),
        messageId: "optimistic-message",
      }),
      {
        body: {
          chatId: "chat-1",
          userId: "user-1",
          model: "model-1",
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

    // Optimistic frame, then the pre-send trim — and nothing after: the SDK
    // appends the replacement itself (with the optimistic edit id), so a
    // post-send removal by that id would delete the just-sent message.
    expect(snapshots).toEqual([["optimistic-edit-message"], []])
    // Edits never allocate — the durable-chat guard proved the chat exists.
    expect(events).not.toContain("ensureChatExists")
    expect(storeAdapters.writeMessages).not.toHaveBeenCalled()
    // The replacement goes out as a full message carrying the optimistic edit
    // id — the same id the edit intent records as the server's
    // clientMessageId — so the live and persisted message share identity and
    // the selected-path projection reconciles instead of swapping.
    expect(adapters.sendMessage).toHaveBeenCalledWith(
      {
        id: "optimistic-edit-message",
        role: "user",
        parts: [{ type: "text", text: "new text" }, targetFile],
        createdAt: expect.any(Date),
      },
      {
        body: expect.objectContaining({
          chatId: "chat-existing",
          userId: "user-1",
          model: "model-1",
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
      "chat-existing"
    )
    expect(adapters.bumpChat).toHaveBeenCalledWith("chat-existing")
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
        id: "optimistic-edit-message",
        role: "user",
        parts: [{ type: "text", text: "new text" }],
        createdAt: expect.any(Date),
      },
      {
        body: expect.objectContaining({
          chatId: "server-chat",
          userId: "user-1",
          model: "model-1",
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
    const {
      adapters,
      controller,
      setMessagesState,
      setSnapshot,
      storeAdapters,
    } = createHarness()
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

  it("records the finish reason and persists the local turn", async () => {
    // The finish matrix across local/durable/pending-edit routes is owned by
    // turn-store.test.ts; this pins the controller's setLastFinishReason
    // wiring plus one persistence pass.
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
  })
})
