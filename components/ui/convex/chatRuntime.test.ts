import { afterEach, describe, expect, it, vi } from "vitest"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx } from "./_generated/server"
import {
  applyApprovalResponses,
  createToolApprovalRequestForChat,
  denyPendingApprovalsForChat,
  markGenerationRunAbortedForChat,
  markGenerationRunAwaitingApprovalForChat,
  markGenerationRunCompletedForChat,
  markGenerationRunFailedForChat,
  prepareGenerationForChat,
  recordToolInvocationsForChat,
} from "./chatRuntime"

type TableName =
  | "toolApprovalRequests"
  | "generationRuns"
  | "messages"
  | "assistantMessageSnapshots"
  | "toolInvocations"
  | "users"
  | "chats"

type TableDocuments = {
  [Table in TableName]: Doc<Table>[]
}

type StoredDocument = TableDocuments[TableName][number]

type QueryBuilder = {
  eq: (fieldName: string, value: unknown) => QueryBuilder
}

type MutationCtxOptions = {
  cloneReads?: boolean
}

function asId<Table extends TableName | "users" | "chats">(
  value: string
): Id<Table> {
  return value as Id<Table>
}

function cloneStoredDocument<Document extends StoredDocument>(
  document: Document
): Document {
  return structuredClone(document) as Document
}

function createMutationCtx(
  tablesInput: Partial<TableDocuments>,
  options: MutationCtxOptions = {}
) {
  const tables: TableDocuments = {
    toolApprovalRequests: [...(tablesInput.toolApprovalRequests ?? [])],
    generationRuns: [...(tablesInput.generationRuns ?? [])],
    messages: [...(tablesInput.messages ?? [])],
    assistantMessageSnapshots: [
      ...(tablesInput.assistantMessageSnapshots ?? []),
    ],
    toolInvocations: [...(tablesInput.toolInvocations ?? [])],
    users: [...(tablesInput.users ?? [])],
    chats: [...(tablesInput.chats ?? [])],
  }
  const patches: Array<{
    id: string
    value: Record<string, unknown>
  }> = []
  const deletes: string[] = []
  const inserts: Array<{
    tableName: TableName
    id: string
    value: Record<string, unknown>
  }> = []

  function findDocument(id: string): StoredDocument | null {
    for (const documents of Object.values(tables)) {
      const document = documents.find((candidate) => candidate._id === id)
      if (document) return document
    }
    return null
  }

  function readDocument<Document extends StoredDocument>(
    document: Document
  ): Document {
    return options.cloneReads ? cloneStoredDocument(document) : document
  }

  const ctx = {
    db: {
      get: async (id: string) => {
        const document = findDocument(id)
        return document ? readDocument(document) : null
      },
      query: (tableName: TableName) => ({
        withIndex: (
          _indexName: string,
          buildQuery: (query: QueryBuilder) => unknown
        ) => {
          const filters = new Map<string, unknown>()
          const query: QueryBuilder = {
            eq: (fieldName, value) => {
              filters.set(fieldName, value)
              return query
            },
          }
          buildQuery(query)

          let results = tables[tableName].filter((document) => {
            const record = document as unknown as Record<string, unknown>
            for (const [fieldName, value] of filters) {
              if (record[fieldName] !== value) return false
            }
            return true
          })

          const resultApi = {
            collect: async () =>
              results.map((document) => readDocument(document)),
            unique: async () => {
              expect(results.length).toBeLessThanOrEqual(1)
              return results[0] ? readDocument(results[0]) : null
            },
            order: (direction: "asc" | "desc") => {
              results = [...results].sort((a, b) => {
                const left = (a as unknown as { orderId?: number }).orderId ?? 0
                const right =
                  (b as unknown as { orderId?: number }).orderId ?? 0
                return direction === "desc" ? right - left : left - right
              })
              return resultApi
            },
            first: async () => (results[0] ? readDocument(results[0]) : null),
            take: async (limit: number) =>
              results.slice(0, limit).map((document) => readDocument(document)),
          }
          return resultApi
        },
      }),
      insert: async (tableName: TableName, value: Record<string, unknown>) => {
        const id = asId<TableName>(
          `${tableName}_${tables[tableName].length + 1}`
        )
        const document = {
          _id: id,
          _creationTime: Date.now(),
          ...value,
        } as StoredDocument
        const tableDocuments = tables[tableName] as StoredDocument[]
        tableDocuments.push(document)
        inserts.push({ tableName, id, value })
        return id
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value })
        const document = findDocument(id)
        expect(document).not.toBeNull()
        Object.assign(document as unknown as Record<string, unknown>, value)
      },
      delete: async (id: string) => {
        deletes.push(id)
        for (const tableDocuments of Object.values(tables)) {
          const index = tableDocuments.findIndex(
            (candidate) => candidate._id === id
          )
          if (index !== -1) {
            tableDocuments.splice(index, 1)
            return
          }
        }
        throw new Error(`Document not found: ${id}`)
      },
    },
    auth: {
      getUserIdentity: async () => ({ subject: "workos_user_1" }),
    },
  } as unknown as MutationCtx

  return { ctx, patches, deletes, inserts, tables }
}

function createOwnerFixture() {
  const userId = asId<"users">("user_1")
  const chatId = asId<"chats">("chat_1")
  const user: Doc<"users"> = {
    _id: userId,
    _creationTime: 1,
    workosUserId: "workos_user_1",
    email: "user@example.com",
  }
  const chat: Doc<"chats"> = {
    _id: chatId,
    _creationTime: 1,
    userId,
    public: false,
    pinned: false,
  }

  return { user, chat, userId, chatId }
}

function createStoredMessage({
  id,
  chatId,
  userId,
  orderId,
  clientMessageId,
  role,
  content,
  createdAt,
}: {
  id: string
  chatId: Id<"chats">
  userId?: Id<"users">
  orderId: number
  clientMessageId?: string
  role: "user" | "assistant"
  content: string
  createdAt: number
}): Doc<"messages"> {
  return {
    _id: asId<"messages">(id),
    _creationTime: createdAt,
    chatId,
    orderId,
    clientMessageId,
    userId: role === "user" ? userId : undefined,
    role,
    content,
    parts: [{ type: "text", text: content }],
    status: "completed",
    createdAt,
    updatedAt: createdAt,
  }
}

function createAssistantRuntimeMessage({
  id,
  chatId,
  runId,
  orderId,
  content = "",
  parts = [],
  status = "streaming",
  createdAt = 1001,
}: {
  id: string
  chatId: Id<"chats">
  runId?: Id<"generationRuns">
  orderId: number
  content?: string
  parts?: unknown
  status?: Doc<"messages">["status"]
  createdAt?: number
}): Doc<"messages"> {
  return {
    _id: asId<"messages">(id),
    _creationTime: createdAt,
    chatId,
    orderId,
    role: "assistant",
    content,
    parts,
    status,
    requestId: runId ? "request_1" : undefined,
    generationRunId: runId,
    model: "gpt-5",
    provider: "openai",
    createdAt,
    updatedAt: createdAt,
  }
}

function createGenerationRun({
  id,
  chatId,
  userId,
  assistantMessageId,
  status = "streaming",
  updatedAt = 1001,
}: {
  id: string
  chatId: Id<"chats">
  userId: Id<"users">
  assistantMessageId?: Id<"messages">
  status?: Doc<"generationRuns">["status"]
  updatedAt?: number
}): Doc<"generationRuns"> {
  return {
    _id: asId<"generationRuns">(id),
    _creationTime: updatedAt,
    chatId,
    userId,
    requestId: "request_1",
    model: "gpt-5",
    provider: "openai",
    status,
    startedAt: updatedAt,
    updatedAt,
    activeStreamId: assistantMessageId,
    assistantMessageId,
  }
}

function createGenerationRunLinkageFixture() {
  const { user, chat, userId, chatId } = createOwnerFixture()
  const runId = asId<"generationRuns">("run_1")
  const otherRunId = asId<"generationRuns">("run_2")
  const messageId = asId<"messages">("message_1")
  const otherMessageId = asId<"messages">("message_2")
  const run = createGenerationRun({
    id: runId,
    chatId,
    userId,
    assistantMessageId: messageId,
  })
  const message = createAssistantRuntimeMessage({
    id: messageId,
    chatId,
    runId,
    orderId: 1,
  })
  const otherMessage = createAssistantRuntimeMessage({
    id: otherMessageId,
    chatId,
    runId: otherRunId,
    orderId: 2,
  })

  return {
    user,
    chat,
    userId,
    chatId,
    runId,
    otherRunId,
    messageId,
    otherMessageId,
    run,
    message,
    otherMessage,
    tables: {
      users: [user],
      chats: [chat],
      generationRuns: [run],
      messages: [message, otherMessage],
    },
  }
}

function createApprovalContinuationFixture(
  decisions: Array<{
    approvalId: string
    approved: boolean
    toolCallId: string
    toolName: string
  }>
) {
  const { user, chat, userId, chatId } = createOwnerFixture()
  const runId = asId<"generationRuns">("run_1")
  const messageId = asId<"messages">("message_1")
  const run: Doc<"generationRuns"> = {
    _id: runId,
    _creationTime: 1,
    chatId,
    userId,
    requestId: "request_1",
    model: "gpt-5",
    provider: "openai",
    status: "awaiting_approval",
    startedAt: 1,
    updatedAt: 1,
    activeStreamId: "message_1",
    assistantMessageId: messageId,
  }
  const message: Doc<"messages"> = {
    _id: messageId,
    _creationTime: 1,
    chatId,
    orderId: 1,
    role: "assistant",
    content: "",
    parts: decisions.map((decision) => ({
      type: `tool-${decision.toolName}`,
      toolCallId: decision.toolCallId,
      state: "approval-requested",
      input: {},
      approval: { id: decision.approvalId },
    })),
    status: "awaiting_approval",
    requestId: "request_1",
    generationRunId: runId,
    model: "gpt-5",
    provider: "openai",
    createdAt: 1,
    updatedAt: 1,
  }
  const requests: Doc<"toolApprovalRequests">[] = decisions.map(
    (decision, index) => ({
      _id: asId<"toolApprovalRequests">(`approval_request_${index + 1}`),
      _creationTime: 1,
      chatId,
      runId,
      assistantMessageId: messageId,
      userId,
      toolCallId: decision.toolCallId,
      toolName: decision.toolName,
      source: "mcp",
      riskClass: "write",
      approvalId: decision.approvalId,
      status: decision.approved ? "approved" : "denied",
      createdAt: 1,
    })
  )
  const invocations: Doc<"toolInvocations">[] = decisions.map(
    (decision, index) => ({
      _id: asId<"toolInvocations">(`tool_invocation_${index + 1}`),
      _creationTime: 1,
      runId,
      chatId,
      messageId,
      toolCallId: decision.toolCallId,
      toolName: decision.toolName,
      source: "mcp",
      input: {},
      status: "pending_approval",
      createdAt: 1,
      updatedAt: 1,
    })
  )
  const tables = {
    toolApprovalRequests: requests,
    generationRuns: [run],
    messages: [message],
    toolInvocations: invocations,
  }
  const responses = decisions.map((decision) => ({
    messageId,
    approvalId: decision.approvalId,
    toolCallId: decision.toolCallId,
    toolName: decision.toolName,
    approved: decision.approved,
  }))

  return {
    owner: { user, chat },
    run,
    invocations,
    tables,
    responses,
  }
}

describe("prepareGenerationForChat", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("applies durable edit intent and creates the run in the same mutation path", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const { user, chat, userId, chatId } = createOwnerFixture()
    const messages: Doc<"messages">[] = [
      createStoredMessage({
        id: "message_user_1",
        chatId,
        userId,
        orderId: 0,
        clientMessageId: "user-1",
        role: "user",
        content: "old text",
        createdAt: 1000,
      }),
      createStoredMessage({
        id: "message_assistant_1",
        chatId,
        orderId: 1,
        role: "assistant",
        content: "old answer",
        createdAt: 1001,
      }),
      createStoredMessage({
        id: "message_user_2",
        chatId,
        userId,
        orderId: 2,
        clientMessageId: "user-2",
        role: "user",
        content: "later text",
        createdAt: 1002,
      }),
      createStoredMessage({
        id: "message_assistant_2",
        chatId,
        orderId: 3,
        role: "assistant",
        content: "later answer",
        createdAt: 1003,
      }),
    ]
    const { ctx, deletes, tables } = createMutationCtx({
      users: [user],
      chats: [chat],
      messages,
    })

    const result = await prepareGenerationForChat(ctx, {
      chatId,
      requestId: "request_edit",
      model: "gpt-5",
      provider: "openai",
      chatVersion: 1,
      edit: {
        editedMessageId: "user-1",
        editCutoffTimestamp: 1000,
        expectedChatVersion: 4,
        replacementMessage: {
          id: "replacement-user",
          role: "user",
          content: "new text",
          parts: [{ type: "text", text: "new text" }],
        },
        title: "new text",
      },
    })

    expect(deletes).toEqual([
      "message_user_1",
      "message_assistant_1",
      "message_user_2",
      "message_assistant_2",
    ])
    expect(tables.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ])
    expect(tables.messages[0]).toMatchObject({
      orderId: 0,
      clientMessageId: "replacement-user",
      content: "new text",
      status: "completed",
    })
    expect(tables.generationRuns[0]).toMatchObject({
      chatId,
      requestId: "request_edit",
      status: "streaming",
      chatVersion: 1,
      assistantMessageId: result.assistantMessageId,
    })
    expect(chat).toMatchObject({
      title: "new text",
      updatedAt: 1700000000000,
    })
    expect(result.messages.map((message) => message.clientMessageId)).toEqual([
      "replacement-user",
    ])
  })

  it("resolves durable edit targets by _id and reconstructs model history from persisted messages", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const { user, chat, userId, chatId } = createOwnerFixture()
    const messages: Doc<"messages">[] = [
      createStoredMessage({
        id: "message_user_0",
        chatId,
        userId,
        orderId: 0,
        clientMessageId: "user-0",
        role: "user",
        content: "setup",
        createdAt: 900,
      }),
      createStoredMessage({
        id: "message_assistant_0",
        chatId,
        orderId: 1,
        role: "assistant",
        content: "setup answer",
        createdAt: 901,
      }),
      createStoredMessage({
        id: "message_user_1",
        chatId,
        userId,
        orderId: 2,
        clientMessageId: "user-1",
        role: "user",
        content: "old text",
        createdAt: 1000,
      }),
      createStoredMessage({
        id: "message_assistant_1",
        chatId,
        orderId: 3,
        role: "assistant",
        content: "old answer",
        createdAt: 1001,
      }),
      createStoredMessage({
        id: "message_user_2",
        chatId,
        userId,
        orderId: 4,
        clientMessageId: "user-2",
        role: "user",
        content: "stale later prompt",
        createdAt: 1002,
      }),
      createStoredMessage({
        id: "message_assistant_2",
        chatId,
        orderId: 5,
        role: "assistant",
        content: "stale later answer",
        createdAt: 1003,
      }),
    ]
    const { ctx, deletes, tables } = createMutationCtx({
      users: [user],
      chats: [chat],
      messages,
    })

    const result = await prepareGenerationForChat(ctx, {
      chatId,
      requestId: "request_edit",
      model: "gpt-5",
      provider: "openai",
      chatVersion: 3,
      edit: {
        editedMessageId: "message_user_1",
        editCutoffTimestamp: 1000,
        expectedChatVersion: 6,
        replacementMessage: {
          id: "replacement-user",
          role: "user",
          content: "new text",
          parts: [{ type: "text", text: "new text" }],
        },
      },
    })

    expect(deletes).toEqual([
      "message_user_1",
      "message_assistant_1",
      "message_user_2",
      "message_assistant_2",
    ])
    expect(result.messages.map((message) => message.content)).toEqual([
      "setup",
      "setup answer",
      "new text",
    ])
    expect(result.messages.map((message) => message.clientMessageId)).toEqual([
      "user-0",
      undefined,
      "replacement-user",
    ])
    expect(
      result.messages.some((message) => message.content.includes("stale later"))
    ).toBe(false)
    expect(tables.messages.map((message) => message.content)).toEqual([
      "setup",
      "setup answer",
      "new text",
      "",
    ])
  })

  it("does not double-insert duplicate replacement client message IDs", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const { user, chat, userId, chatId } = createOwnerFixture()
    const messages: Doc<"messages">[] = [
      createStoredMessage({
        id: "message_user_1",
        chatId,
        userId,
        orderId: 0,
        clientMessageId: "user-1",
        role: "user",
        content: "old text",
        createdAt: 1000,
      }),
      createStoredMessage({
        id: "message_replacement",
        chatId,
        userId,
        orderId: 1,
        clientMessageId: "replacement-user",
        role: "user",
        content: "new text",
        createdAt: 1001,
      }),
      createStoredMessage({
        id: "message_later",
        chatId,
        orderId: 2,
        role: "assistant",
        content: "later answer",
        createdAt: 1002,
      }),
    ]
    const { ctx, tables } = createMutationCtx({
      users: [user],
      chats: [chat],
      messages,
    })

    await prepareGenerationForChat(ctx, {
      chatId,
      requestId: "request_edit",
      model: "gpt-5",
      provider: "openai",
      edit: {
        editedMessageId: "user-1",
        editCutoffTimestamp: 1000,
        expectedChatVersion: 3,
        replacementMessage: {
          id: "replacement-user",
          role: "user",
          content: "new text",
          parts: [{ type: "text", text: "new text" }],
        },
      },
    })

    expect(
      tables.messages.filter(
        (message) => message.clientMessageId === "replacement-user"
      )
    ).toHaveLength(1)
  })

  it("checks ownership before applying durable edit intent", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const { user, chat, userId, chatId } = createOwnerFixture()
    const otherUserId = asId<"users">("user_2")
    chat.userId = otherUserId
    const messages: Doc<"messages">[] = [
      createStoredMessage({
        id: "message_user_1",
        chatId,
        userId,
        orderId: 0,
        clientMessageId: "user-1",
        role: "user",
        content: "old text",
        createdAt: 1000,
      }),
    ]
    const { ctx, deletes, tables } = createMutationCtx({
      users: [user],
      chats: [chat],
      messages,
    })

    await expect(
      prepareGenerationForChat(ctx, {
        chatId,
        requestId: "request_edit",
        model: "gpt-5",
        provider: "openai",
        edit: {
          editedMessageId: "user-1",
          editCutoffTimestamp: 1000,
          expectedChatVersion: 1,
          replacementMessage: {
            id: "replacement-user",
            role: "user",
            content: "new text",
            parts: [{ type: "text", text: "new text" }],
          },
        },
      })
    ).rejects.toThrow("Not authorized")

    expect(deletes).toEqual([])
    expect(tables.generationRuns).toEqual([])
    expect(tables.messages).toEqual(messages)
  })

  it("applies durable regeneration intent by reusing the target assistant and excluding its old response from model history", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const { user, chat, userId, chatId } = createOwnerFixture()
    const messages: Doc<"messages">[] = [
      createStoredMessage({
        id: "message_user_1",
        chatId,
        userId,
        orderId: 0,
        clientMessageId: "user-1",
        role: "user",
        content: "first text",
        createdAt: 1000,
      }),
      createStoredMessage({
        id: "message_assistant_1",
        chatId,
        orderId: 1,
        role: "assistant",
        content: "first answer",
        createdAt: 1001,
      }),
      createStoredMessage({
        id: "message_user_2",
        chatId,
        userId,
        orderId: 2,
        clientMessageId: "user-2",
        role: "user",
        content: "second text",
        createdAt: 1002,
      }),
      createStoredMessage({
        id: "message_assistant_2",
        chatId,
        orderId: 3,
        role: "assistant",
        content: "old second answer",
        createdAt: 1003,
      }),
    ]
    const { ctx, inserts, tables } = createMutationCtx({
      users: [user],
      chats: [chat],
      messages,
    })

    const result = await prepareGenerationForChat(ctx, {
      chatId,
      requestId: "request_regen",
      model: "gpt-5",
      provider: "openai",
      chatVersion: 4,
      regeneration: {
        targetAssistantMessageId: "message_assistant_2",
        targetAssistantCreatedAt: 1003,
        expectedChatVersion: 4,
        precedingUserMessageId: "user-2",
      },
    })

    expect(result.assistantMessageId).toBe("message_assistant_2")
    expect(result.assistantOrder).toBe(3)
    expect(inserts.filter((insert) => insert.tableName === "messages")).toEqual(
      []
    )
    expect(tables.messages).toHaveLength(4)
    expect(messages[3]).toMatchObject({
      status: "streaming",
      requestId: "request_regen",
      generationRunId: result.runId,
      content: "old second answer",
      parts: [{ type: "text", text: "old second answer" }],
    })
    expect(result.messages.map((message) => message._id)).toEqual([
      "message_user_1",
      "message_assistant_1",
      "message_user_2",
    ])
    expect(result.messages).not.toContainEqual(
      expect.objectContaining({ _id: "message_assistant_2" })
    )
  })

  it("keeps coherent history after regenerate then send another message", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const { user, chat, userId, chatId } = createOwnerFixture()
    const targetAssistant = createStoredMessage({
      id: "message_assistant_1",
      chatId,
      orderId: 1,
      role: "assistant",
      content: "old answer",
      createdAt: 1001,
    })
    const { ctx, tables } = createMutationCtx({
      users: [user],
      chats: [chat],
      messages: [
        createStoredMessage({
          id: "message_user_1",
          chatId,
          userId,
          orderId: 0,
          clientMessageId: "user-1",
          role: "user",
          content: "prompt",
          createdAt: 1000,
        }),
        targetAssistant,
      ],
    })

    const regeneration = await prepareGenerationForChat(ctx, {
      chatId,
      requestId: "request_regen",
      model: "gpt-5",
      provider: "openai",
      regeneration: {
        targetAssistantMessageId: "message_assistant_1",
        targetAssistantCreatedAt: 1001,
        expectedChatVersion: 2,
        precedingUserMessageId: "user-1",
      },
    })

    Object.assign(targetAssistant, {
      content: "new answer",
      parts: [{ type: "text", text: "new answer" }],
      status: "completed",
    })

    const followUp = await prepareGenerationForChat(ctx, {
      chatId,
      requestId: "request_followup",
      model: "gpt-5",
      provider: "openai",
      latestUserMessage: {
        id: "user-2",
        role: "user",
        content: "next prompt",
        parts: [{ type: "text", text: "next prompt" }],
      },
    })

    expect(regeneration.messages.map((message) => message._id)).toEqual([
      "message_user_1",
    ])
    expect(followUp.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
    ])
    expect(
      followUp.messages.filter((message) => message.role === "assistant")
    ).toEqual([expect.objectContaining({ content: "new answer" })])
    expect(
      tables.messages.filter((message) => message.role === "assistant")
    ).toHaveLength(2)
  })

  it("regenerates after a previously stopped turn without retaining stale empty placeholders", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const { user, chat, userId, chatId } = createOwnerFixture()
    const targetAssistant = createStoredMessage({
      id: "message_assistant_2",
      chatId,
      orderId: 3,
      role: "assistant",
      content: "old second answer",
      createdAt: 1003,
    })
    const { ctx, deletes, tables } = createMutationCtx({
      users: [user],
      chats: [chat],
      messages: [
        createStoredMessage({
          id: "message_user_1",
          chatId,
          userId,
          orderId: 0,
          clientMessageId: "user-1",
          role: "user",
          content: "first prompt",
          createdAt: 1000,
        }),
        createAssistantRuntimeMessage({
          id: "message_empty_assistant",
          chatId,
          orderId: 1,
          parts: [],
          content: "",
          status: "aborted",
          createdAt: 1001,
        }),
        createStoredMessage({
          id: "message_user_2",
          chatId,
          userId,
          orderId: 2,
          clientMessageId: "user-2",
          role: "user",
          content: "second prompt",
          createdAt: 1002,
        }),
        targetAssistant,
      ],
    })

    const result = await prepareGenerationForChat(ctx, {
      chatId,
      requestId: "request_regen",
      model: "gpt-5",
      provider: "openai",
      regeneration: {
        targetAssistantMessageId: "message_assistant_2",
        targetAssistantCreatedAt: 1003,
        expectedChatVersion: 3,
        precedingUserMessageId: "user-2",
      },
    })

    expect(deletes).toContain("message_empty_assistant")
    expect(result.assistantMessageId).toBe("message_assistant_2")
    expect(result.messages.map((message) => message._id)).toEqual([
      "message_user_1",
      "message_user_2",
    ])
    expect(tables.messages.map((message) => message._id)).toEqual([
      "message_user_1",
      "message_user_2",
      "message_assistant_2",
    ])
    expect(targetAssistant).toMatchObject({
      status: "streaming",
      content: "old second answer",
    })
  })

  it("edits after stopped and regenerated turns without retaining stale empty placeholders", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const { user, chat, userId, chatId } = createOwnerFixture()
    const { ctx, deletes } = createMutationCtx({
      users: [user],
      chats: [chat],
      messages: [
        createStoredMessage({
          id: "message_user_1",
          chatId,
          userId,
          orderId: 0,
          clientMessageId: "user-1",
          role: "user",
          content: "first prompt",
          createdAt: 1000,
        }),
        createAssistantRuntimeMessage({
          id: "message_partial_assistant",
          chatId,
          orderId: 1,
          content: "partial answer",
          parts: [{ type: "text", text: "partial answer" }],
          status: "aborted",
          createdAt: 1001,
        }),
        createAssistantRuntimeMessage({
          id: "message_empty_assistant",
          chatId,
          orderId: 2,
          parts: [],
          content: "",
          status: "aborted",
          createdAt: 1002,
        }),
        createStoredMessage({
          id: "message_user_2",
          chatId,
          userId,
          orderId: 3,
          clientMessageId: "user-2",
          role: "user",
          content: "second prompt",
          createdAt: 1003,
        }),
        createStoredMessage({
          id: "message_assistant_2",
          chatId,
          orderId: 4,
          role: "assistant",
          content: "regenerated answer",
          createdAt: 1004,
        }),
      ],
    })

    const result = await prepareGenerationForChat(ctx, {
      chatId,
      requestId: "request_edit",
      model: "gpt-5",
      provider: "openai",
      edit: {
        editedMessageId: "user-2",
        editCutoffTimestamp: 1003,
        expectedChatVersion: 4,
        replacementMessage: {
          id: "replacement-user-2",
          role: "user",
          content: "edited second prompt",
          parts: [{ type: "text", text: "edited second prompt" }],
        },
      },
    })

    expect(deletes).toEqual([
      "message_empty_assistant",
      "message_user_2",
      "message_assistant_2",
    ])
    expect(result.messages.map((message) => message._id)).toEqual([
      "message_user_1",
      "message_partial_assistant",
      "messages_3",
    ])
    expect(
      result.messages.some(
        (message) => message.role === "assistant" && message.parts.length === 0
      )
    ).toBe(false)
  })

  it("rejects stale or unsupported durable regeneration intents", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const { user, chat, userId, chatId } = createOwnerFixture()
    const messages: Doc<"messages">[] = [
      createStoredMessage({
        id: "message_user_1",
        chatId,
        userId,
        orderId: 0,
        clientMessageId: "user-1",
        role: "user",
        content: "first text",
        createdAt: 1000,
      }),
      createStoredMessage({
        id: "message_assistant_1",
        chatId,
        orderId: 1,
        role: "assistant",
        content: "first answer",
        createdAt: 1001,
      }),
      createStoredMessage({
        id: "message_user_2",
        chatId,
        userId,
        orderId: 2,
        clientMessageId: "user-2",
        role: "user",
        content: "second text",
        createdAt: 1002,
      }),
      createStoredMessage({
        id: "message_assistant_2",
        chatId,
        orderId: 3,
        role: "assistant",
        content: "second answer",
        createdAt: 1003,
      }),
    ]

    async function expectRegenerationRejected(
      regeneration: {
        targetAssistantMessageId: string
        targetAssistantCreatedAt: number
        expectedChatVersion: number
        precedingUserMessageId: string
      },
      message: string
    ) {
      const { ctx } = createMutationCtx({
        users: [user],
        chats: [chat],
        messages: messages.map((storedMessage) => ({ ...storedMessage })),
      })
      await expect(
        prepareGenerationForChat(ctx, {
          chatId,
          requestId: "request_regen",
          model: "gpt-5",
          provider: "openai",
          regeneration,
        })
      ).rejects.toThrow(message)
    }

    await expectRegenerationRejected(
      {
        targetAssistantMessageId: "message_assistant_2",
        targetAssistantCreatedAt: 1003,
        expectedChatVersion: 3,
        precedingUserMessageId: "user-2",
      },
      "Chat changed since regeneration started"
    )
    await expectRegenerationRejected(
      {
        targetAssistantMessageId: "message_assistant_2",
        targetAssistantCreatedAt: 9999,
        expectedChatVersion: 4,
        precedingUserMessageId: "user-2",
      },
      "Regeneration target version changed"
    )
    await expectRegenerationRejected(
      {
        targetAssistantMessageId: "user-2",
        targetAssistantCreatedAt: 1002,
        expectedChatVersion: 4,
        precedingUserMessageId: "user-1",
      },
      "Regeneration target must be an assistant message"
    )
    await expectRegenerationRejected(
      {
        targetAssistantMessageId: "message_assistant_1",
        targetAssistantCreatedAt: 1001,
        expectedChatVersion: 4,
        precedingUserMessageId: "user-1",
      },
      "Only the latest assistant message can be regenerated"
    )
    await expectRegenerationRejected(
      {
        targetAssistantMessageId: "message_assistant_2",
        targetAssistantCreatedAt: 1003,
        expectedChatVersion: 4,
        precedingUserMessageId: "user-1",
      },
      "Regeneration preceding user message mismatch"
    )
  })

  it("checks ownership before applying durable regeneration intent", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const { user, chat, userId, chatId } = createOwnerFixture()
    chat.userId = asId<"users">("user_2")
    const messages = [
      createStoredMessage({
        id: "message_user_1",
        chatId,
        userId,
        orderId: 0,
        clientMessageId: "user-1",
        role: "user",
        content: "prompt",
        createdAt: 1000,
      }),
      createStoredMessage({
        id: "message_assistant_1",
        chatId,
        orderId: 1,
        role: "assistant",
        content: "answer",
        createdAt: 1001,
      }),
    ]
    const { ctx, tables } = createMutationCtx({
      users: [user],
      chats: [chat],
      messages,
    })

    await expect(
      prepareGenerationForChat(ctx, {
        chatId,
        requestId: "request_regen",
        model: "gpt-5",
        provider: "openai",
        regeneration: {
          targetAssistantMessageId: "message_assistant_1",
          targetAssistantCreatedAt: 1001,
          expectedChatVersion: 2,
          precedingUserMessageId: "user-1",
        },
      })
    ).rejects.toThrow("Not authorized")

    expect(tables.generationRuns).toEqual([])
    expect(tables.messages).toEqual(messages)
  })

  it("retains previous assistant content when regeneration aborts or fails before first chunk", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)

    async function prepareRegenerationRun() {
      const { user, chat, userId, chatId } = createOwnerFixture()
      const targetAssistant = createStoredMessage({
        id: "message_assistant_1",
        chatId,
        orderId: 1,
        role: "assistant",
        content: "old answer",
        createdAt: 1001,
      })
      const harness = createMutationCtx({
        users: [user],
        chats: [chat],
        messages: [
          createStoredMessage({
            id: "message_user_1",
            chatId,
            userId,
            orderId: 0,
            clientMessageId: "user-1",
            role: "user",
            content: "prompt",
            createdAt: 1000,
          }),
          targetAssistant,
        ],
      })
      const result = await prepareGenerationForChat(harness.ctx, {
        chatId,
        requestId: "request_regen",
        model: "gpt-5",
        provider: "openai",
        regeneration: {
          targetAssistantMessageId: "message_assistant_1",
          targetAssistantCreatedAt: 1001,
          expectedChatVersion: 2,
          precedingUserMessageId: "user-1",
        },
      })
      return { ...harness, result, targetAssistant }
    }

    const aborted = await prepareRegenerationRun()
    await markGenerationRunAbortedForChat(aborted.ctx, {
      runId: aborted.result.runId,
      messageId: aborted.result.assistantMessageId,
      reason: "stream aborted",
    })
    expect(aborted.deletes).toEqual([])
    expect(aborted.targetAssistant).toMatchObject({
      content: "old answer",
      parts: [{ type: "text", text: "old answer" }],
      status: "completed",
    })

    const failed = await prepareRegenerationRun()
    await markGenerationRunFailedForChat(failed.ctx, {
      runId: failed.result.runId,
      messageId: failed.result.assistantMessageId,
      error: "provider failed",
    })
    expect(failed.deletes).toEqual([])
    expect(failed.targetAssistant).toMatchObject({
      content: "old answer",
      parts: [{ type: "text", text: "old answer" }],
      status: "completed",
    })
  })

  it("preserves partial regenerated assistant content on abort", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const { user, chat, userId, chatId } = createOwnerFixture()
    const targetAssistant = createStoredMessage({
      id: "message_assistant_1",
      chatId,
      orderId: 1,
      role: "assistant",
      content: "old answer",
      createdAt: 1001,
    })
    const { ctx, tables } = createMutationCtx({
      users: [user],
      chats: [chat],
      messages: [
        createStoredMessage({
          id: "message_user_1",
          chatId,
          userId,
          orderId: 0,
          clientMessageId: "user-1",
          role: "user",
          content: "prompt",
          createdAt: 1000,
        }),
        targetAssistant,
      ],
    })
    const result = await prepareGenerationForChat(ctx, {
      chatId,
      requestId: "request_regen",
      model: "gpt-5",
      provider: "openai",
      regeneration: {
        targetAssistantMessageId: "message_assistant_1",
        targetAssistantCreatedAt: 1001,
        expectedChatVersion: 2,
        precedingUserMessageId: "user-1",
      },
    })

    Object.assign(targetAssistant, {
      content: "partial new answer",
      parts: [{ type: "text", text: "partial new answer" }],
    })
    await ctx.db.insert("assistantMessageSnapshots", {
      runId: result.runId,
      chatId,
      messageId: result.assistantMessageId,
      order: result.assistantOrder,
      stepOrder: 0,
      sequence: 1,
      format: "text_snapshot",
      textSnapshot: "partial new answer",
      partsSnapshot: [{ type: "text", text: "partial new answer" }],
      createdAt: 1700000000000,
    })

    await markGenerationRunAbortedForChat(ctx, {
      runId: result.runId,
      messageId: result.assistantMessageId,
      reason: "stream aborted",
    })

    expect(targetAssistant).toMatchObject({
      content: "partial new answer",
      parts: [{ type: "text", text: "partial new answer" }],
      status: "aborted",
      error: "stream aborted",
    })
    expect(tables.messages.map((message) => message._id)).toEqual([
      "message_user_1",
      "message_assistant_1",
    ])
  })

  it("deletes an empty assistant placeholder when a run aborts before the first chunk", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const { user, chat, userId, chatId } = createOwnerFixture()
    const runId = asId<"generationRuns">("run_1")
    const assistantMessageId = asId<"messages">("message_empty_assistant")
    const userMessage = createStoredMessage({
      id: "message_user_1",
      chatId,
      userId,
      orderId: 0,
      clientMessageId: "user-1",
      role: "user",
      content: "write something long",
      createdAt: 1000,
    })
    const assistantMessage = createAssistantRuntimeMessage({
      id: assistantMessageId,
      chatId,
      runId,
      orderId: 1,
      parts: [],
      content: "",
      status: "streaming",
    })
    const run = createGenerationRun({
      id: runId,
      chatId,
      userId,
      assistantMessageId,
    })
    const { ctx, deletes, tables } = createMutationCtx({
      users: [user],
      chats: [chat],
      messages: [userMessage, assistantMessage],
      generationRuns: [run],
    })

    await markGenerationRunAbortedForChat(ctx, {
      runId,
      messageId: assistantMessageId,
      reason: "stream aborted",
    })

    expect(deletes).toEqual(["message_empty_assistant"])
    expect(tables.messages.map((message) => message._id)).toEqual([
      "message_user_1",
    ])
    expect(run).toMatchObject({
      status: "aborted",
      error: "stream aborted",
      completedAt: 1700000000000,
      activeStreamId: undefined,
      assistantMessageId: undefined,
    })
  })

  it("sanitizes a prior streaming empty placeholder before preparing the next generation", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const { user, chat, userId, chatId } = createOwnerFixture()
    const runId = asId<"generationRuns">("run_1")
    const assistantMessageId = asId<"messages">("message_empty_assistant")
    const messages: Doc<"messages">[] = [
      createStoredMessage({
        id: "message_user_1",
        chatId,
        userId,
        orderId: 0,
        clientMessageId: "user-1",
        role: "user",
        content: "first prompt",
        createdAt: 1000,
      }),
      createAssistantRuntimeMessage({
        id: assistantMessageId,
        chatId,
        runId,
        orderId: 1,
        parts: [],
        content: "",
        status: "streaming",
      }),
    ]
    const run = createGenerationRun({
      id: runId,
      chatId,
      userId,
      assistantMessageId,
    })
    const { ctx, deletes, tables } = createMutationCtx({
      users: [user],
      chats: [chat],
      messages,
      generationRuns: [run],
    })

    const result = await prepareGenerationForChat(ctx, {
      chatId,
      requestId: "request_2",
      model: "gpt-5",
      provider: "openai",
      latestUserMessage: {
        id: "user-2",
        role: "user",
        content: "next prompt",
        parts: [{ type: "text", text: "next prompt" }],
      },
    })

    expect(deletes).toEqual(["message_empty_assistant"])
    expect(run).toMatchObject({
      status: "aborted",
      activeStreamId: undefined,
      assistantMessageId: undefined,
    })
    expect(result.messages.map((message) => message.role)).toEqual([
      "user",
      "user",
    ])
    expect(
      result.messages.some(
        (message) => message.role === "assistant" && message.parts.length === 0
      )
    ).toBe(false)
    expect(tables.messages.map((message) => message.role)).toEqual([
      "user",
      "user",
      "assistant",
    ])
  })

  it("preserves a partial stopped assistant message in model history", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const { user, chat, userId, chatId } = createOwnerFixture()
    const runId = asId<"generationRuns">("run_1")
    const assistantMessageId = asId<"messages">("message_partial_assistant")
    const partialAssistant = createAssistantRuntimeMessage({
      id: assistantMessageId,
      chatId,
      runId,
      orderId: 1,
      content: "partial answer",
      parts: [{ type: "text", text: "partial answer" }],
      status: "streaming",
    })
    const run = createGenerationRun({
      id: runId,
      chatId,
      userId,
      assistantMessageId,
    })
    const { ctx, deletes } = createMutationCtx({
      users: [user],
      chats: [chat],
      messages: [
        createStoredMessage({
          id: "message_user_1",
          chatId,
          userId,
          orderId: 0,
          clientMessageId: "user-1",
          role: "user",
          content: "first prompt",
          createdAt: 1000,
        }),
        partialAssistant,
      ],
      generationRuns: [run],
    })

    const result = await prepareGenerationForChat(ctx, {
      chatId,
      requestId: "request_2",
      model: "gpt-5",
      provider: "openai",
      latestUserMessage: {
        id: "user-2",
        role: "user",
        content: "next prompt",
        parts: [{ type: "text", text: "next prompt" }],
      },
    })

    expect(deletes).toEqual([])
    expect(partialAssistant).toMatchObject({
      status: "aborted",
      content: "partial answer",
      parts: [{ type: "text", text: "partial answer" }],
    })
    expect(result.messages.map((message) => message._id)).toEqual([
      "message_user_1",
      "message_partial_assistant",
      "messages_3",
    ])
  })
})

describe("generation run linkage validation", () => {
  it("rejects awaiting-approval updates for assistant messages outside the run", async () => {
    const fixture = createGenerationRunLinkageFixture()
    const { ctx, patches } = createMutationCtx(fixture.tables)

    await expect(
      markGenerationRunAwaitingApprovalForChat(ctx, {
        runId: fixture.runId,
        messageId: fixture.otherMessageId,
      })
    ).rejects.toThrow("Assistant message not found for run")

    expect(patches).toEqual([])
    expect(fixture.run.status).toBe("streaming")
    expect(fixture.otherMessage.status).toBe("streaming")
  })

  it("rejects completion updates for assistant messages outside the run", async () => {
    const fixture = createGenerationRunLinkageFixture()
    const { ctx, patches } = createMutationCtx(fixture.tables)

    await expect(
      markGenerationRunCompletedForChat(ctx, {
        runId: fixture.runId,
        messageId: fixture.otherMessageId,
        content: "done",
        parts: [{ type: "text", text: "done" }],
      })
    ).rejects.toThrow("Assistant message not found for run")

    expect(patches).toEqual([])
    expect(fixture.run.status).toBe("streaming")
    expect(fixture.otherMessage.content).toBe("")
  })

  it("rejects approval requests for assistant messages outside the run", async () => {
    const fixture = createGenerationRunLinkageFixture()
    const { ctx, inserts, patches } = createMutationCtx(fixture.tables)

    await expect(
      createToolApprovalRequestForChat(ctx, {
        chatId: fixture.chatId,
        runId: fixture.runId,
        assistantMessageId: fixture.otherMessageId,
        toolCallId: "call_1",
        toolName: "send_email",
        source: "mcp",
        riskClass: "destructive",
        approvalId: "approval_1",
      })
    ).rejects.toThrow("Assistant message not found for run")

    expect(inserts).toEqual([])
    expect(patches).toEqual([])
  })

  it("rejects tool invocations for assistant messages outside the run", async () => {
    const fixture = createGenerationRunLinkageFixture()
    const { ctx, inserts, patches } = createMutationCtx(fixture.tables)

    await expect(
      recordToolInvocationsForChat(ctx, {
        chatId: fixture.chatId,
        runId: fixture.runId,
        messageId: fixture.otherMessageId,
        invocations: [
          {
            toolCallId: "call_1",
            toolName: "send_email",
            source: "mcp",
            status: "called",
          },
        ],
      })
    ).rejects.toThrow("Assistant message not found for run")

    expect(inserts).toEqual([])
    expect(patches).toEqual([])
  })

  it("rejects tool invocations linked to another run's approval request", async () => {
    const fixture = createGenerationRunLinkageFixture()
    const approval: Doc<"toolApprovalRequests"> = {
      _id: asId<"toolApprovalRequests">("approval_request_1"),
      _creationTime: 1,
      chatId: fixture.chatId,
      runId: fixture.otherRunId,
      assistantMessageId: fixture.otherMessageId,
      userId: fixture.userId,
      toolCallId: "call_1",
      toolName: "send_email",
      source: "mcp",
      riskClass: "destructive",
      approvalId: "approval_1",
      status: "pending",
      createdAt: 1,
    }
    const { ctx, inserts, patches } = createMutationCtx({
      ...fixture.tables,
      toolApprovalRequests: [approval],
    })

    await expect(
      recordToolInvocationsForChat(ctx, {
        chatId: fixture.chatId,
        runId: fixture.runId,
        messageId: fixture.messageId,
        invocations: [
          {
            toolCallId: "call_1",
            toolName: "send_email",
            source: "mcp",
            status: "pending_approval",
            approvalRequestId: "approval_1",
          },
        ],
      })
    ).rejects.toThrow("Approval request does not belong to this run")

    expect(inserts).toEqual([])
    expect(patches).toEqual([])
  })
})

describe("applyApprovalResponses", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("aborts a run when any approval response for that run is denied", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const fixture = createApprovalContinuationFixture([
      {
        approvalId: "approval_denied",
        approved: false,
        toolCallId: "call_denied",
        toolName: "delete_file",
      },
      {
        approvalId: "approval_approved",
        approved: true,
        toolCallId: "call_approved",
        toolName: "read_file",
      },
    ])
    const { ctx, patches } = createMutationCtx(fixture.tables)

    await applyApprovalResponses(ctx, fixture.owner, fixture.responses)

    expect(fixture.run).toMatchObject({
      status: "aborted",
      completedAt: 1700000000000,
      updatedAt: 1700000000000,
      activeStreamId: undefined,
    })
    expect(fixture.invocations.map((invocation) => invocation.status)).toEqual([
      "denied",
      "approved",
    ])
    expect(patches.filter((patch) => patch.id === fixture.run._id)).toEqual([
      {
        id: fixture.run._id,
        value: {
          status: "aborted",
          completedAt: 1700000000000,
          updatedAt: 1700000000000,
          activeStreamId: undefined,
        },
      },
    ])
  })

  it("completes a run when all approval responses for that run are approved", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const fixture = createApprovalContinuationFixture([
      {
        approvalId: "approval_1",
        approved: true,
        toolCallId: "call_1",
        toolName: "read_file",
      },
      {
        approvalId: "approval_2",
        approved: true,
        toolCallId: "call_2",
        toolName: "list_files",
      },
    ])
    const { ctx } = createMutationCtx(fixture.tables)

    await applyApprovalResponses(ctx, fixture.owner, fixture.responses)

    expect(fixture.run).toMatchObject({
      status: "completed",
      completedAt: 1700000000000,
      updatedAt: 1700000000000,
      activeStreamId: undefined,
    })
  })

  it("preserves earlier approval responses when multiple responses patch one message", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const fixture = createApprovalContinuationFixture([
      {
        approvalId: "approval_denied",
        approved: false,
        toolCallId: "call_denied",
        toolName: "delete_file",
      },
      {
        approvalId: "approval_approved",
        approved: true,
        toolCallId: "call_approved",
        toolName: "read_file",
      },
    ])
    const { ctx } = createMutationCtx(fixture.tables, { cloneReads: true })

    await applyApprovalResponses(ctx, fixture.owner, fixture.responses)

    expect(fixture.tables.messages[0]?.parts).toEqual([
      {
        type: "tool-delete_file",
        toolCallId: "call_denied",
        state: "approval-responded",
        input: {},
        approval: {
          id: "approval_denied",
          approved: false,
        },
      },
      {
        type: "tool-read_file",
        toolCallId: "call_approved",
        state: "approval-responded",
        input: {},
        approval: {
          id: "approval_approved",
          approved: true,
        },
      },
    ])
  })
})

describe("denyPendingApprovalsForChat", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("closes the approval request, run, assistant message, and invocation", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)

    const chatId = asId<"chats">("chat_1")
    const userId = asId<"users">("user_1")
    const otherUserId = asId<"users">("user_2")
    const runId = asId<"generationRuns">("run_1")
    const messageId = asId<"messages">("message_1")
    const requestId = asId<"toolApprovalRequests">("approval_request_1")
    const invocationId = asId<"toolInvocations">("tool_invocation_1")

    const request: Doc<"toolApprovalRequests"> = {
      _id: requestId,
      _creationTime: 1,
      chatId,
      runId,
      assistantMessageId: messageId,
      userId,
      toolCallId: "call_1",
      toolName: "send_email",
      source: "mcp",
      reason: "Needs approval",
      riskClass: "destructive",
      approvalId: "approval_1",
      status: "pending",
      createdAt: 1,
    }
    const otherUserRequest: Doc<"toolApprovalRequests"> = {
      ...request,
      _id: asId<"toolApprovalRequests">("approval_request_2"),
      userId: otherUserId,
      approvalId: "approval_2",
      toolCallId: "call_2",
    }
    const run: Doc<"generationRuns"> = {
      _id: runId,
      _creationTime: 1,
      chatId,
      userId,
      requestId: "request_1",
      model: "gpt-5",
      provider: "openai",
      status: "awaiting_approval",
      startedAt: 1,
      updatedAt: 1,
      activeStreamId: "message_1",
      assistantMessageId: messageId,
    }
    const message: Doc<"messages"> = {
      _id: messageId,
      _creationTime: 1,
      chatId,
      orderId: 1,
      role: "assistant",
      content: "",
      parts: [
        {
          type: "tool-send_email",
          toolCallId: "call_1",
          state: "approval-requested",
          input: { to: "person@example.com" },
          approval: { id: "approval_1" },
        },
      ],
      status: "awaiting_approval",
      requestId: "request_1",
      generationRunId: runId,
      model: "gpt-5",
      provider: "openai",
      createdAt: 1,
      updatedAt: 1,
    }
    const invocation: Doc<"toolInvocations"> = {
      _id: invocationId,
      _creationTime: 1,
      runId,
      chatId,
      messageId,
      toolCallId: "call_1",
      toolName: "send_email",
      source: "mcp",
      input: { to: "person@example.com" },
      inputPreview: '{"to":"person@example.com"}',
      status: "pending_approval",
      createdAt: 1,
      updatedAt: 1,
    }
    const unrelatedInvocation: Doc<"toolInvocations"> = {
      ...invocation,
      _id: asId<"toolInvocations">("tool_invocation_2"),
      toolCallId: "call_unrelated",
      status: "called",
    }
    const tables = {
      toolApprovalRequests: [request, otherUserRequest],
      generationRuns: [run],
      messages: [message],
      toolInvocations: [invocation, unrelatedInvocation],
    }
    const { ctx, patches } = createMutationCtx(tables)

    await denyPendingApprovalsForChat(
      ctx,
      chatId,
      userId,
      "auto-denied: new generation started"
    )

    expect(request).toMatchObject({
      status: "denied",
      resolvedAt: 1700000000000,
      resolvedByUserId: userId,
      reason: "auto-denied: new generation started",
    })
    expect(otherUserRequest.status).toBe("pending")
    expect(message).toMatchObject({
      status: "aborted",
      error: "auto-denied: new generation started",
      updatedAt: 1700000000000,
    })
    expect(message.parts).toEqual([
      {
        type: "tool-send_email",
        toolCallId: "call_1",
        state: "approval-responded",
        input: { to: "person@example.com" },
        approval: {
          id: "approval_1",
          approved: false,
          reason: "auto-denied: new generation started",
        },
      },
    ])
    expect(invocation).toMatchObject({
      status: "denied",
      approvalId: requestId,
      approvalRequestId: "approval_1",
      completedAt: 1700000000000,
      updatedAt: 1700000000000,
    })
    expect(unrelatedInvocation.status).toBe("called")
    expect(run).toMatchObject({
      status: "aborted",
      error: "auto-denied: new generation started",
      completedAt: 1700000000000,
      updatedAt: 1700000000000,
      activeStreamId: undefined,
    })
    expect(patches.map((patch) => patch.id)).toEqual([
      requestId,
      messageId,
      invocationId,
      runId,
    ])
  })
})
