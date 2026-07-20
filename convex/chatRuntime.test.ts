import { afterEach, describe, expect, it, vi } from "vitest"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx } from "./_generated/server"
import {
  applyApprovalResponses,
  createToolApprovalRequestForChat,
  denyPendingApprovalsForChat,
  heartbeatGenerationRunForChat,
  markGenerationRunAbortedForChat,
  markGenerationRunCompletedForChat,
  markGenerationRunFailedForChat,
  prepareGenerationForChat,
  reapExpiredGenerationRunsPass,
  reapExpiredToolApprovalsPass,
  recordToolInvocationsForChat,
  resolveToolCallDecision,
  stopGenerationRunForChat,
  updateAssistantSnapshotForChat,
} from "./chatRuntime"
import {
  APPROVAL_EXPIRY_MS,
  LEASE_DURATION_MS,
} from "./domain/generation_run_liveness"
import { getSelectedPathMessages } from "./domain/message_branches"
import type { AuthenticatedRunOwner } from "./lib/auth"
import { selectBranchForChat } from "./messages"

type TableDocuments = {
  toolApprovalRequests: Doc<"toolApprovalRequests">[]
  generationRuns: Doc<"generationRuns">[]
  messages: Doc<"messages">[]
  assistantMessageSnapshots: Doc<"assistantMessageSnapshots">[]
  toolInvocations: Doc<"toolInvocations">[]
  users: Doc<"users">[]
  chats: Doc<"chats">[]
}

type TableName = keyof TableDocuments
type StoredDocument = TableDocuments[TableName][number]

type QueryBuilder = {
  eq: (fieldName: string, value: unknown) => QueryBuilder
  gt: (fieldName: string, value: unknown) => QueryBuilder
  lt: (fieldName: string, value: unknown) => QueryBuilder
}

// Convex index-order rank: undefined < null < everything else. Enough to model
// the reaper's `.gt(field, undefined).lt(field, now)` range in the fake db.
function convexOrderRank(value: unknown): number {
  if (value === undefined) return 0
  if (value === null) return 1
  return 2
}

function convexOrderCompare(left: unknown, right: unknown): number {
  const rankDelta = convexOrderRank(left) - convexOrderRank(right)
  if (rankDelta !== 0) return rankDelta
  if (typeof left === "number" && typeof right === "number") {
    return left === right ? 0 : left < right ? -1 : 1
  }
  return 0
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
    toolApprovalRequests: [],
    generationRuns: [],
    messages: [],
    assistantMessageSnapshots: [],
    toolInvocations: [],
    users: [],
    chats: [],
    ...tablesInput,
  }
  const patches: Array<{
    id: string
    value: Record<string, unknown>
  }> = []
  const getCalls: string[] = []
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
        getCalls.push(id)
        const document = findDocument(id)
        return document ? readDocument(document) : null
      },
      normalizeId: (tableName: TableName, id: string) => {
        return tables[tableName].some((document) => document._id === id)
          ? asId<TableName>(id)
          : null
      },
      query: (tableName: TableName) => ({
        withIndex: (
          _indexName: string,
          buildQuery: (query: QueryBuilder) => unknown
        ) => {
          const filters = new Map<string, unknown>()
          const rangeFilters: Array<{
            fieldName: string
            op: "gt" | "lt"
            value: unknown
          }> = []
          const query: QueryBuilder = {
            eq: (fieldName, value) => {
              filters.set(fieldName, value)
              return query
            },
            gt: (fieldName, value) => {
              rangeFilters.push({ fieldName, op: "gt", value })
              return query
            },
            lt: (fieldName, value) => {
              rangeFilters.push({ fieldName, op: "lt", value })
              return query
            },
          }
          buildQuery(query)

          let results = (tables[tableName] as StoredDocument[]).filter(
            (document) => {
              const record = document as unknown as Record<string, unknown>
              for (const [fieldName, value] of filters) {
                if (record[fieldName] !== value) return false
              }
              for (const range of rangeFilters) {
                const comparison = convexOrderCompare(
                  record[range.fieldName],
                  range.value
                )
                if (range.op === "gt" && comparison <= 0) return false
                if (range.op === "lt" && comparison >= 0) return false
              }
              return true
            }
          )

          const resultApi = {
            collect: async () =>
              results.map((document) => readDocument(document)),
            unique: async () => {
              expect(results.length).toBeLessThanOrEqual(1)
              return results[0] ? readDocument(results[0]) : null
            },
            order: (direction: "asc" | "desc") => {
              results = [...results].sort((a, b) => {
                const leftRecord = a as unknown as {
                  orderId?: number
                  sequence?: number
                }
                const rightRecord = b as unknown as {
                  orderId?: number
                  sequence?: number
                }
                const left = leftRecord.sequence ?? leftRecord.orderId ?? 0
                const right = rightRecord.sequence ?? rightRecord.orderId ?? 0
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
        ;(tables[tableName] as StoredDocument[]).push(document)
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

  return { ctx, getCalls, patches, deletes, inserts, tables }
}

/**
 * Build the `AuthenticatedRunOwner` a run-scoped core now receives — the same
 * `{ user, chat, run }` bundle `ownedGenerationRunMutation` injects in
 * production. Deriving all three from the run doc mirrors the builder's
 * transitive ownership (run → chat → owner), so tests exercise the cores'
 * logic without re-standing-up the auth path the builder is tested against once.
 */
async function runOwner(
  ctx: MutationCtx,
  runId: Id<"generationRuns">
): Promise<AuthenticatedRunOwner> {
  const run = await ctx.db.get(runId)
  if (!run) throw new Error(`runOwner: generation run ${runId} not found`)
  const chat = await ctx.db.get(run.chatId)
  if (!chat) throw new Error(`runOwner: chat ${run.chatId} not found`)
  const user = await ctx.db.get(chat.userId)
  if (!user) throw new Error(`runOwner: user ${chat.userId} not found`)
  return { user, chat, run }
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
    updatedAt: 1,
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
  const tables: TableDocuments = {
    toolApprovalRequests: [],
    generationRuns: [run],
    messages: [message, otherMessage],
    assistantMessageSnapshots: [],
    toolInvocations: [],
    users: [user],
    chats: [chat],
  }

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
    tables,
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

    expect(deletes).toEqual([])
    expect(tables.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
      "assistant",
    ])
    const replacement = tables.messages.find(
      (message) => message.clientMessageId === "replacement-user"
    )
    expect(replacement).toMatchObject({
      clientMessageId: "replacement-user",
      content: "new text",
      status: "completed",
      branchIndex: 1,
      selected: true,
    })
    expect(messages[0]).toMatchObject({
      selected: false,
    })
    expect(
      tables.messages.find(
        (message) => message._id === result.assistantMessageId
      )
    ).toMatchObject({
      parentMessageId: replacement?._id,
      branchIndex: 0,
      selected: true,
    })
    expect(tables.generationRuns[0]).toMatchObject({
      chatId,
      requestId: "request_edit",
      status: "streaming",
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

    expect(deletes).toEqual([])
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
    expect(tables.messages.map((message) => message.content)).toContain(
      "stale later prompt"
    )
    expect(tables.messages.map((message) => message.content)).toContain(
      "stale later answer"
    )
    expect(
      tables.messages.find((message) => message.clientMessageId === "user-1")
    ).toMatchObject({ selected: false })
    expect(
      tables.messages.find(
        (message) => message.clientMessageId === "replacement-user"
      )
    ).toMatchObject({
      parentMessageId: "message_assistant_0",
      selected: true,
    })
  })

  it("keeps legacy descendants selectable after editing the first user message", async () => {
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
        content: "first prompt",
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
        content: "second prompt",
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
        editedMessageId: "message_user_1",
        editCutoffTimestamp: 1000,
        expectedChatVersion: 4,
        replacementMessage: {
          id: "replacement-user-1",
          role: "user",
          content: "edited first prompt",
          parts: [{ type: "text", text: "edited first prompt" }],
        },
      },
    })

    await selectBranchForChat(ctx, {
      chatId,
      messageId: asId<"messages">("message_user_1"),
    })

    expect(
      getSelectedPathMessages(tables.messages).map((message) => message._id)
    ).toEqual([
      "message_user_1",
      "message_assistant_1",
      "message_user_2",
      "message_assistant_2",
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

  it("accepts normal sends when the selected path token matches", async () => {
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

    const result = await prepareGenerationForChat(ctx, {
      chatId,
      requestId: "request_followup",
      model: "gpt-5",
      provider: "openai",
      expectedVisibleMessageCount: 2,
      tailMessageId: "message_assistant_1",
      latestUserMessage: {
        id: "user-2",
        role: "user",
        content: "next prompt",
        parts: [{ type: "text", text: "next prompt" }],
      },
    })

    const insertedUser = tables.messages.find(
      (message) => message.clientMessageId === "user-2"
    )
    const insertedAssistant = tables.messages.find(
      (message) => message._id === result.assistantMessageId
    )

    expect(result.messages.map((message) => message.content)).toEqual([
      "prompt",
      "answer",
      "next prompt",
    ])
    expect(insertedUser).toMatchObject({
      parentMessageId: "message_assistant_1",
      branchIndex: 0,
      selected: true,
    })
    expect(insertedAssistant).toMatchObject({
      parentMessageId: insertedUser?._id,
      branchIndex: 0,
      selected: true,
      status: "streaming",
    })
  })

  for (const terminalStub of [
    {
      status: "failed" as const,
      error: "provider rejected",
      historyMarker:
        "[This response failed with an error before producing content.]",
    },
    {
      status: "aborted" as const,
      error: "stream aborted",
      historyMarker: "[This response was stopped before producing content.]",
    },
  ]) {
    it(`accepts normal sends when an unseen ${terminalStub.status} stub is the only token mismatch`, async () => {
      vi.spyOn(Date, "now").mockReturnValue(1700000000000)
      const { user, chat, userId, chatId } = createOwnerFixture()
      const assistantMessageId = asId<"messages">(
        `message_${terminalStub.status}_assistant`
      )
      const terminalAssistant = {
        ...createAssistantRuntimeMessage({
          id: assistantMessageId,
          chatId,
          orderId: 1,
          parts: [],
          content: "",
          status: terminalStub.status,
          createdAt: 1001,
        }),
        error: terminalStub.error,
      }
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
          terminalAssistant,
        ],
      })

      const result = await prepareGenerationForChat(ctx, {
        chatId,
        requestId: "request_followup",
        model: "gpt-5",
        provider: "openai",
        expectedVisibleMessageCount: 1,
        tailMessageId: "message_user_1",
        latestUserMessage: {
          id: "user-2",
          role: "user",
          content: "next prompt",
          parts: [{ type: "text", text: "next prompt" }],
        },
      })

      const insertedUser = tables.messages.find(
        (message) => message.clientMessageId === "user-2"
      )
      const insertedAssistant = tables.messages.find(
        (message) => message._id === result.assistantMessageId
      )

      expect(result.messages.map((message) => message.content)).toEqual([
        "prompt",
        terminalStub.historyMarker,
        "next prompt",
      ])
      expect(insertedUser).toMatchObject({
        parentMessageId: assistantMessageId,
        branchIndex: 0,
        selected: true,
      })
      expect(insertedAssistant).toMatchObject({
        parentMessageId: insertedUser?._id,
        branchIndex: 0,
        selected: true,
        status: "streaming",
      })
    })
  }

  it("rejects normal sends when the selected branch changed with the same visible count", async () => {
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
        content: "prompt",
        createdAt: 1000,
      }),
      {
        ...createStoredMessage({
          id: "message_assistant_old",
          chatId,
          orderId: 1,
          role: "assistant",
          content: "old answer",
          createdAt: 1001,
        }),
        parentMessageId: asId<"messages">("message_user_1"),
        branchIndex: 0,
        selected: false,
      },
      {
        ...createStoredMessage({
          id: "message_assistant_new",
          chatId,
          orderId: 2,
          role: "assistant",
          content: "new answer",
          createdAt: 1002,
        }),
        parentMessageId: asId<"messages">("message_user_1"),
        branchIndex: 1,
        selected: true,
      },
    ]
    const { ctx, tables } = createMutationCtx({
      users: [user],
      chats: [chat],
      messages,
    })

    await expect(
      prepareGenerationForChat(ctx, {
        chatId,
        requestId: "request_stale",
        model: "gpt-5",
        provider: "openai",
        expectedVisibleMessageCount: 2,
        tailMessageId: "message_assistant_old",
        latestUserMessage: {
          id: "user-2",
          role: "user",
          content: "next prompt",
          parts: [{ type: "text", text: "next prompt" }],
        },
      })
    ).rejects.toThrow("Stale chat state: selected path changed")

    expect(tables.generationRuns).toEqual([])
    expect(
      tables.messages.some((message) => message.clientMessageId === "user-2")
    ).toBe(false)
  })

  it("rejects stale normal sends before aborting the active run", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const { user, chat, userId, chatId } = createOwnerFixture()
    const runId = asId<"generationRuns">("run_1")
    const activeAssistantId = asId<"messages">("message_assistant_new")
    const activeAssistant = {
      ...createAssistantRuntimeMessage({
        id: activeAssistantId,
        chatId,
        runId,
        orderId: 2,
        content: "streaming answer",
        parts: [{ type: "text", text: "streaming answer" }],
        createdAt: 1002,
      }),
      parentMessageId: asId<"messages">("message_user_1"),
      branchIndex: 1,
      selected: true,
    }
    const run = createGenerationRun({
      id: runId,
      chatId,
      userId,
      assistantMessageId: activeAssistantId,
    })
    const { ctx, deletes, patches, tables } = createMutationCtx({
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
        {
          ...createStoredMessage({
            id: "message_assistant_old",
            chatId,
            orderId: 1,
            role: "assistant",
            content: "old answer",
            createdAt: 1001,
          }),
          parentMessageId: asId<"messages">("message_user_1"),
          branchIndex: 0,
          selected: false,
        },
        activeAssistant,
      ],
      generationRuns: [run],
    })

    await expect(
      prepareGenerationForChat(ctx, {
        chatId,
        requestId: "request_stale",
        model: "gpt-5",
        provider: "openai",
        expectedVisibleMessageCount: 2,
        tailMessageId: "message_assistant_old",
        latestUserMessage: {
          id: "user-2",
          role: "user",
          content: "next prompt",
          parts: [{ type: "text", text: "next prompt" }],
        },
      })
    ).rejects.toThrow("Stale chat state: selected path changed")

    expect(patches).toEqual([])
    expect(deletes).toEqual([])
    expect(run).toMatchObject({
      status: "streaming",
      activeStreamId: activeAssistantId,
      assistantMessageId: activeAssistantId,
    })
    expect(activeAssistant).toMatchObject({ status: "streaming" })
    expect(
      tables.messages.some((message) => message.clientMessageId === "user-2")
    ).toBe(false)
  })

  it("applies durable regeneration intent by appending a selected assistant sibling", async () => {
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
      regeneration: {
        targetAssistantMessageId: "message_assistant_2",
        targetAssistantCreatedAt: 1003,
        expectedChatVersion: 4,
        precedingUserMessageId: "user-2",
      },
    })

    expect(result.assistantOrder).toBe(4)
    expect(
      inserts.filter((insert) => insert.tableName === "messages")
    ).toContainEqual(expect.objectContaining({ id: result.assistantMessageId }))
    expect(tables.messages).toHaveLength(5)
    expect(messages[3]).toMatchObject({
      status: "completed",
      content: "old second answer",
      parts: [{ type: "text", text: "old second answer" }],
      selected: false,
    })
    expect(tables.messages[4]).toMatchObject({
      _id: result.assistantMessageId,
      parentMessageId: "message_user_2",
      branchIndex: 1,
      selected: true,
      status: "streaming",
      requestId: "request_regen",
      generationRunId: result.runId,
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

  it("applies durable regeneration intent to a mid-conversation assistant", async () => {
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
        content: "old first answer",
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
      regeneration: {
        targetAssistantMessageId: "message_assistant_1",
        targetAssistantCreatedAt: 1001,
        expectedChatVersion: 4,
        precedingUserMessageId: "user-1",
      },
    })

    // Forks under the preceding user message; the old assistant is deselected.
    expect(
      inserts.filter((insert) => insert.tableName === "messages")
    ).toContainEqual(expect.objectContaining({ id: result.assistantMessageId }))
    expect(tables.messages).toHaveLength(5)
    expect(messages[1]).toMatchObject({
      content: "old first answer",
      selected: false,
    })
    expect(tables.messages[4]).toMatchObject({
      _id: result.assistantMessageId,
      parentMessageId: "message_user_1",
      branchIndex: 1,
      selected: true,
      status: "streaming",
      requestId: "request_regen",
      generationRunId: result.runId,
    })
    // The old continuation (user_2 → assistant_2) is retained as a deselected
    // sibling branch, not deleted.
    expect(tables.messages.map((message) => message._id)).toEqual(
      expect.arrayContaining(["message_user_2", "message_assistant_2"])
    )
    // Model prefix is everything up to and including the preceding user message.
    expect(result.messages.map((message) => message._id)).toEqual([
      "message_user_1",
    ])
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

    const regeneratedAssistant = tables.messages.find(
      (message) => message._id === regeneration.assistantMessageId
    )
    Object.assign(regeneratedAssistant ?? {}, {
      content: "new answer",
      parts: [{ type: "text", text: "new answer" }],
      status: "completed",
    })

    const followUp = await prepareGenerationForChat(ctx, {
      chatId,
      requestId: "request_followup",
      model: "gpt-5",
      provider: "openai",
      expectedVisibleMessageCount: 2,
      tailMessageId: regeneration.assistantMessageId,
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
    expect(targetAssistant).toMatchObject({ selected: false })
    expect(regeneratedAssistant).toMatchObject({ selected: true })
    expect(
      tables.messages.filter((message) => message.role === "assistant")
    ).toHaveLength(3)
  })

  it("regenerates after a previously stopped turn, keeping the stopped stub as a first-class turn", async () => {
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
        // The aborted stub is a visible first-class turn now, counted by the
        // client's rendered path like any other message.
        expectedChatVersion: 4,
        precedingUserMessageId: "user-2",
      },
    })

    expect(deletes).toEqual([])
    expect(result.messages.map((message) => message._id)).toEqual([
      "message_user_1",
      "message_empty_assistant",
      "message_user_2",
    ])
    expect(result.messages[1]).toMatchObject({
      parts: [
        {
          type: "text",
          text: "[This response was stopped before producing content.]",
        },
      ],
    })
    expect(tables.messages.map((message) => message._id)).toEqual([
      "message_user_1",
      "message_empty_assistant",
      "message_user_2",
      "message_assistant_2",
      result.assistantMessageId,
    ])
    expect(targetAssistant).toMatchObject({
      status: "completed",
      content: "old second answer",
      selected: false,
    })
    expect(
      tables.messages.find(
        (message) => message._id === result.assistantMessageId
      )
    ).toMatchObject({
      parentMessageId: "message_user_2",
      selected: true,
      status: "streaming",
    })
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
    // The version guard still rejects a stale mid-conversation target (the
    // tail restriction is lifted, but optimistic concurrency is not).
    await expectRegenerationRejected(
      {
        targetAssistantMessageId: "message_assistant_1",
        targetAssistantCreatedAt: 9999,
        expectedChatVersion: 4,
        precedingUserMessageId: "user-1",
      },
      "Regeneration target version changed"
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

  it("counts the edit version guard over the raw client view amid sparse branch state", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const { user, chat, userId, chatId } = createOwnerFixture()

    // A rapid regenerate leaves sparse branch state behind: the old answer is
    // deselected while the regenerated sibling carries no branchIndex or
    // selected stamp yet. The client's expectedChatVersion counts the RAW
    // selected-path projection (the messages.ts read derivation). This pins
    // the guard to that same raw view — a write-side normalization pass
    // running BEFORE the guard (the pre-branch-writer shape) is the "edit
    // falsely rejected after a rapid multi-branch session" bug class.
    function sparseBranchMessages() {
      return [
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
        {
          ...createStoredMessage({
            id: "message_assistant_old",
            chatId,
            orderId: 1,
            role: "assistant",
            content: "old answer",
            createdAt: 1001,
          }),
          parentMessageId: asId<"messages">("message_user_1"),
          branchIndex: 0,
          selected: false,
        },
        {
          ...createStoredMessage({
            id: "message_assistant_new",
            chatId,
            orderId: 2,
            role: "assistant",
            content: "regenerated answer",
            createdAt: 1002,
          }),
          parentMessageId: asId<"messages">("message_user_1"),
          // Sparse on purpose: no branchIndex, no selected stamp yet.
        },
      ]
    }

    function editIntent(expectedChatVersion: number) {
      return {
        editedMessageId: "user-1",
        editCutoffTimestamp: 1000,
        expectedChatVersion,
        replacementMessage: {
          id: "replacement-user",
          role: "user" as const,
          content: "edited prompt",
          parts: [{ type: "text", text: "edited prompt" }],
        },
      }
    }

    // The raw projection renders [prompt, regenerated answer] → version 2.
    const accepted = createMutationCtx({
      users: [user],
      chats: [chat],
      messages: sparseBranchMessages(),
    })
    const result = await prepareGenerationForChat(accepted.ctx, {
      chatId,
      requestId: "request_edit",
      model: "gpt-5",
      provider: "openai",
      edit: editIntent(2),
    })
    expect(result.runId).toBeDefined()

    // A genuinely stale count still rejects.
    const rejected = createMutationCtx({
      users: [user],
      chats: [chat],
      messages: sparseBranchMessages(),
    })
    await expect(
      prepareGenerationForChat(rejected.ctx, {
        chatId,
        requestId: "request_edit",
        model: "gpt-5",
        provider: "openai",
        edit: editIntent(3),
      })
    ).rejects.toThrow("Chat changed since edit started")
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
    await markGenerationRunAbortedForChat(
      aborted.ctx,
      await runOwner(aborted.ctx, aborted.result.runId),
      {
        messageId: aborted.result.assistantMessageId,
        reason: "stream aborted",
      }
    )
    expect(aborted.deletes).toEqual([aborted.result.assistantMessageId])
    expect(aborted.targetAssistant).toMatchObject({
      content: "old answer",
      parts: [{ type: "text", text: "old answer" }],
      status: "completed",
      selected: true,
    })

    const failed = await prepareRegenerationRun()
    await markGenerationRunFailedForChat(
      failed.ctx,
      await runOwner(failed.ctx, failed.result.runId),
      {
        messageId: failed.result.assistantMessageId,
        error: "provider failed",
      }
    )
    expect(failed.deletes).toEqual([failed.result.assistantMessageId])
    expect(failed.targetAssistant).toMatchObject({
      content: "old answer",
      parts: [{ type: "text", text: "old answer" }],
      status: "completed",
      selected: true,
    })
  })

  it("restores the regeneration target on empty abort when a newer sibling exists", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const { user, chat, userId, chatId } = createOwnerFixture()
    const branchOne = {
      ...createStoredMessage({
        id: "message_assistant_1",
        chatId,
        orderId: 1,
        role: "assistant",
        content: "answer one",
        createdAt: 1001,
      }),
      parentMessageId: asId<"messages">("message_user_1"),
      branchIndex: 0,
      selected: true,
    }
    const branchTwo = {
      ...createStoredMessage({
        id: "message_assistant_2",
        chatId,
        orderId: 2,
        role: "assistant",
        content: "answer two",
        createdAt: 1002,
      }),
      parentMessageId: asId<"messages">("message_user_1"),
      branchIndex: 1,
      selected: false,
    }
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
          content: "prompt",
          createdAt: 1000,
        }),
        branchOne,
        branchTwo,
      ],
    })

    // The user branch-navigated back to branch one before regenerating it.
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
    await markGenerationRunAbortedForChat(ctx, await runOwner(ctx, result.runId), {
      messageId: result.assistantMessageId,
      reason: "stream aborted",
    })

    expect(deletes).toEqual([result.assistantMessageId])
    expect(branchOne).toMatchObject({ selected: true })
    expect(branchTwo).toMatchObject({ selected: false })
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

    const regeneratedAssistant = tables.messages.find(
      (message) => message._id === result.assistantMessageId
    )
    Object.assign(regeneratedAssistant ?? {}, {
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

    await markGenerationRunAbortedForChat(ctx, await runOwner(ctx, result.runId), {
      messageId: result.assistantMessageId,
      reason: "stream aborted",
    })

    expect(regeneratedAssistant).toMatchObject({
      content: "partial new answer",
      parts: [{ type: "text", text: "partial new answer" }],
      status: "aborted",
      error: "stream aborted",
      selected: true,
    })
    expect(targetAssistant).toMatchObject({
      content: "old answer",
      status: "completed",
      selected: false,
    })
    expect(tables.messages.map((message) => message._id)).toEqual([
      "message_user_1",
      "message_assistant_1",
      result.assistantMessageId,
    ])
  })

  it("keeps and marks an empty assistant placeholder when a run aborts before the first chunk", async () => {
    // The stub IS the turn's durable outcome: deleting it made the turn
    // invisible (user bubble with no marker) and its user message got
    // re-sent as duplicate history. A fresh send has no sibling answer to
    // revert to, so the placeholder stays, marked aborted.
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

    await markGenerationRunAbortedForChat(ctx, await runOwner(ctx, runId), {
      messageId: assistantMessageId,
      reason: "stream aborted",
    })

    expect(deletes).toEqual([])
    expect(tables.messages.map((message) => message._id)).toEqual([
      "message_user_1",
      "message_empty_assistant",
    ])
    expect(assistantMessage).toMatchObject({
      status: "aborted",
      error: "stream aborted",
    })
    expect(run).toMatchObject({
      status: "aborted",
      error: "stream aborted",
      completedAt: 1700000000000,
      activeStreamId: undefined,
      assistantMessageId,
    })
  })

  it("converges to failed in both orders of the onError/envelope-finish race", async () => {
    // An errored stream fires BOTH the streamText onError (failed write) and
    // the response envelope's onFinish (completed write, isAborted false).
    // Whichever lands first, the run must settle failed — the envelope's
    // empty "completion" repainting a failed run is what hid the failed stub.
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)

    function makeFixture() {
      const { user, chat, userId, chatId } = createOwnerFixture()
      const runId = asId<"generationRuns">("run_1")
      const assistantMessageId = asId<"messages">("message_empty_assistant")
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
      const { ctx } = createMutationCtx({
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
          assistantMessage,
        ],
        generationRuns: [run],
      })
      return { ctx, run, assistantMessage, runId, assistantMessageId }
    }

    // Order 1: failed lands first; the completed write must no-op.
    const first = makeFixture()
    await markGenerationRunFailedForChat(
      first.ctx,
      await runOwner(first.ctx, first.runId),
      {
        messageId: first.assistantMessageId,
        error: "provider rejected",
      }
    )
    await markGenerationRunCompletedForChat(
      first.ctx,
      await runOwner(first.ctx, first.runId),
      {
        messageId: first.assistantMessageId,
        content: "",
        parts: [],
      }
    )
    expect(first.run).toMatchObject({
      status: "failed",
      error: "provider rejected",
    })
    expect(first.assistantMessage).toMatchObject({ status: "failed" })

    // Order 2: completed lands first; the failed write must overwrite it.
    const second = makeFixture()
    await markGenerationRunCompletedForChat(
      second.ctx,
      await runOwner(second.ctx, second.runId),
      {
        messageId: second.assistantMessageId,
        content: "",
        parts: [],
      }
    )
    await markGenerationRunFailedForChat(
      second.ctx,
      await runOwner(second.ctx, second.runId),
      {
        messageId: second.assistantMessageId,
        error: "provider rejected",
      }
    )
    expect(second.run).toMatchObject({
      status: "failed",
      error: "provider rejected",
    })
    expect(second.assistantMessage).toMatchObject({ status: "failed" })

    // Aborted is settled: a late failure signal may not repaint a user Stop.
    const third = makeFixture()
    await markGenerationRunAbortedForChat(
      third.ctx,
      await runOwner(third.ctx, third.runId),
      {
        messageId: third.assistantMessageId,
        reason: "stream aborted",
      }
    )
    await markGenerationRunFailedForChat(
      third.ctx,
      await runOwner(third.ctx, third.runId),
      {
        messageId: third.assistantMessageId,
        error: "late failure",
      }
    )
    expect(third.run).toMatchObject({
      status: "aborted",
      error: "stream aborted",
    })
    expect(third.assistantMessage).toMatchObject({ status: "aborted" })
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
      expectedVisibleMessageCount: 1,
      tailMessageId: "message_user_1",
      latestUserMessage: {
        id: "user-2",
        role: "user",
        content: "next prompt",
        parts: [{ type: "text", text: "next prompt" }],
      },
    })

    // The zombie placeholder is superseded, not erased: it stays as a
    // first-class aborted stub marking its turn's outcome, and projects into
    // model history as an explicit "never answered" marker instead of leaving
    // the first prompt looking fresh.
    expect(deletes).toEqual([])
    expect(run).toMatchObject({
      status: "aborted",
      activeStreamId: undefined,
      assistantMessageId: asId<"messages">("message_empty_assistant"),
    })
    expect(messages[1]).toMatchObject({
      status: "aborted",
      error: "superseded by a new generation",
    })
    expect(result.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
    ])
    expect(result.messages[1]).toMatchObject({
      parts: [
        {
          type: "text",
          text: "[This response was stopped before producing content.]",
        },
      ],
    })
    expect(
      result.messages.some(
        (message) => message.role === "assistant" && message.parts.length === 0
      )
    ).toBe(false)
    expect(tables.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
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
        partialAssistant,
      ],
      generationRuns: [run],
    })

    const result = await prepareGenerationForChat(ctx, {
      chatId,
      requestId: "request_2",
      model: "gpt-5",
      provider: "openai",
      expectedVisibleMessageCount: 2,
      tailMessageId: "message_partial_assistant",
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
    const insertedUser = tables.messages.find(
      (message) => message.clientMessageId === "user-2"
    )
    expect(result.messages.map((message) => message._id)).toEqual([
      "message_user_1",
      "message_partial_assistant",
      insertedUser?._id,
    ])
  })
})

describe("generation run linkage validation", () => {
  it("rejects completion updates for assistant messages outside the run", async () => {
    const fixture = createGenerationRunLinkageFixture()
    const { ctx, patches } = createMutationCtx(fixture.tables)

    await expect(
      markGenerationRunCompletedForChat(
        ctx,
        await runOwner(ctx, fixture.runId),
        {
          messageId: fixture.otherMessageId,
          content: "done",
          parts: [{ type: "text", text: "done" }],
        }
      )
    ).rejects.toThrow("Assistant message not found for run")

    expect(patches).toEqual([])
    expect(fixture.run.status).toBe("streaming")
    expect(fixture.otherMessage.content).toBe("")
  })

  it("does not re-bump the chat's updatedAt when a run completes", async () => {
    // Per ADR-0005: a durable turn must
    // bump chats.updatedAt exactly once, at turn start (chatRuntime.ts:1257). The
    // chat has already re-ordered to the top of the sidebar by completion time, so
    // the run-complete path must NOT bump it again.
    const fixture = createGenerationRunLinkageFixture()
    const { ctx, patches } = createMutationCtx(fixture.tables)

    await markGenerationRunCompletedForChat(
      ctx,
      await runOwner(ctx, fixture.runId),
      {
        messageId: fixture.messageId,
        content: "done",
        parts: [{ type: "text", text: "done" }],
      }
    )

    // No write to the chat row on the completion path (one bump per turn): its
    // updatedAt is left exactly as it was at turn start.
    expect(patches.filter((patch) => patch.id === fixture.chatId)).toEqual([])
    expect(fixture.chat.updatedAt).toBe(1)

    // The run and assistant-message patches still fire.
    expect(fixture.run.status).toBe("completed")
    expect(fixture.message.status).toBe("completed")
    expect(fixture.message.content).toBe("done")
  })

  it("ignores a late approval request on a run a Stop already aborted (zombie-repaint fix)", async () => {
    // User Stop settles the run first; then a late approval-request write from
    // the stream's persistence transform arrives. It must not repaint the run
    // awaiting_approval nor accrue a pending row (which would feed
    // hasPendingApprovals on a future completion) — the Generation run
    // lifecycle's approval-requested rule ignores the terminal run.
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const fixture = createGenerationRunLinkageFixture()
    const { ctx } = createMutationCtx(fixture.tables)

    await markGenerationRunAbortedForChat(ctx, await runOwner(ctx, fixture.runId), {
      messageId: fixture.messageId,
      reason: "stream aborted",
    })
    expect(fixture.run.status).toBe("aborted")

    const approvalRequestId = await createToolApprovalRequestForChat(
      ctx,
      await runOwner(ctx, fixture.runId),
      {
        assistantMessageId: fixture.messageId,
        toolCallId: "call_late",
        toolName: "send_email",
        source: "mcp",
        riskClass: "destructive",
        approvalId: "approval_late",
      }
    )

    expect(approvalRequestId).toBeNull()
    expect(fixture.tables.toolApprovalRequests).toEqual([])
    expect(fixture.run.status).toBe("aborted")
    expect(fixture.message).toMatchObject({
      status: "aborted",
      error: "stream aborted",
    })
  })

  it("ignores a late approval request after Stop deleted the empty regeneration placeholder", async () => {
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
    const { ctx, deletes, inserts, patches, tables } = createMutationCtx({
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
    await markGenerationRunAbortedForChat(ctx, await runOwner(ctx, result.runId), {
      messageId: result.assistantMessageId,
      reason: "stream aborted",
    })
    expect(deletes).toEqual([result.assistantMessageId])
    expect(
      tables.messages.some(
        (message) => message._id === result.assistantMessageId
      )
    ).toBe(false)

    const insertCountBeforeApproval = inserts.length
    const patchCountBeforeApproval = patches.length
    const approvalRequestId = await createToolApprovalRequestForChat(
      ctx,
      await runOwner(ctx, result.runId),
      {
        assistantMessageId: result.assistantMessageId,
        toolCallId: "call_late",
        toolName: "send_email",
        source: "mcp",
        riskClass: "destructive",
        approvalId: "approval_late",
      }
    )

    const run = tables.generationRuns.find(
      (generationRun) => generationRun._id === result.runId
    )
    expect(approvalRequestId).toBeNull()
    expect(tables.toolApprovalRequests).toEqual([])
    expect(inserts).toHaveLength(insertCountBeforeApproval)
    expect(patches).toHaveLength(patchCountBeforeApproval)
    expect(run).toMatchObject({
      status: "aborted",
      assistantMessageId: undefined,
    })
    expect(targetAssistant).toMatchObject({
      content: "old answer",
      status: "completed",
      selected: true,
    })
  })

  it("rejects tool invocations for assistant messages outside the run", async () => {
    const fixture = createGenerationRunLinkageFixture()
    const { ctx, inserts, patches } = createMutationCtx(fixture.tables)

    await expect(
      recordToolInvocationsForChat(ctx, await runOwner(ctx, fixture.runId), {
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
      recordToolInvocationsForChat(ctx, await runOwner(ctx, fixture.runId), {
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

  it("rejects tool invocations once the run is terminal (post-settlement write)", async () => {
    // The gameplan §10 guard matrix: a terminal run is read-only to its old
    // worker. recordToolInvocations was the one worker op missing this guard.
    const fixture = createGenerationRunLinkageFixture()
    const { ctx, inserts } = createMutationCtx(fixture.tables)

    await markGenerationRunAbortedForChat(
      ctx,
      await runOwner(ctx, fixture.runId),
      { messageId: fixture.messageId, reason: "user stop" }
    )
    expect(fixture.run.status).toBe("aborted")

    await recordToolInvocationsForChat(ctx, await runOwner(ctx, fixture.runId), {
      messageId: fixture.messageId,
      invocations: [
        {
          toolCallId: "call_late",
          toolName: "send_email",
          source: "mcp",
          status: "called",
        },
      ],
    })

    expect(fixture.tables.toolInvocations).toEqual([])
    expect(
      inserts.filter((insert) => insert.tableName === "toolInvocations")
    ).toEqual([])
  })

  it("cannot stamp a different assistant message in the same chat via fail/abort", async () => {
    // gatherAssistantMessageFacts enforces run→message linkage: a worker
    // payload naming another run's assistant message must not receive this
    // run's terminal outcome. The run half still settles.
    const fixture = createGenerationRunLinkageFixture()
    const { ctx } = createMutationCtx(fixture.tables)

    await markGenerationRunFailedForChat(
      ctx,
      await runOwner(ctx, fixture.runId),
      { messageId: fixture.otherMessageId, error: "provider exploded" }
    )

    expect(fixture.run.status).toBe("failed")
    // The unlinked message keeps its own state — no failed stamp, no error.
    expect(fixture.otherMessage.status).toBe("streaming")
    expect(fixture.otherMessage.error).toBeUndefined()
    // The run's own linked message is untouched too (the caller misnamed the
    // target, so the message half is a no-op, not a redirect).
    expect(fixture.message.status).toBe("streaming")
  })
})

describe("execution grant revocation", () => {
  const GRANT = {
    grantDigest: "d".repeat(64),
    grantExpiresAt: 2_000_000,
  }

  it("clears the grant when a run reaches an absorbing outcome (aborted)", async () => {
    const fixture = createGenerationRunLinkageFixture()
    Object.assign(fixture.run, GRANT)
    const { ctx } = createMutationCtx(fixture.tables)

    await markGenerationRunAbortedForChat(
      ctx,
      await runOwner(ctx, fixture.runId),
      { messageId: fixture.messageId, reason: "user stop" }
    )

    expect(fixture.run.status).toBe("aborted")
    expect(fixture.run.grantDigest).toBeUndefined()
    expect(fixture.run.grantExpiresAt).toBeUndefined()
  })

  it("keeps the grant at completed so the fail-over-completed convergence stays writable", async () => {
    const fixture = createGenerationRunLinkageFixture()
    Object.assign(fixture.run, GRANT)
    const { ctx } = createMutationCtx(fixture.tables)

    await markGenerationRunCompletedForChat(
      ctx,
      await runOwner(ctx, fixture.runId),
      {
        messageId: fixture.messageId,
        content: "done",
        parts: [{ type: "text", text: "done" }],
      }
    )
    expect(fixture.run.status).toBe("completed")
    expect(fixture.run.grantDigest).toBe(GRANT.grantDigest)
    expect(fixture.run.grantExpiresAt).toBe(GRANT.grantExpiresAt)

    // The deliberate convergence: the late failure write still lands through
    // the retained grant, and reaching failed (absorbing) then revokes.
    await markGenerationRunFailedForChat(
      ctx,
      await runOwner(ctx, fixture.runId),
      { messageId: fixture.messageId, error: "stream errored" }
    )
    expect(fixture.run.status).toBe("failed")
    expect(fixture.run.grantDigest).toBeUndefined()
    expect(fixture.run.grantExpiresAt).toBeUndefined()
  })

  it("keeps the grant at the awaiting_approval pause (the worker's era is not over)", async () => {
    const fixture = createGenerationRunLinkageFixture()
    Object.assign(fixture.run, GRANT)
    const { ctx } = createMutationCtx(fixture.tables)

    await createToolApprovalRequestForChat(
      ctx,
      await runOwner(ctx, fixture.runId),
      {
        assistantMessageId: fixture.messageId,
        toolCallId: "call_1",
        toolName: "send_email",
        source: "mcp",
        riskClass: "destructive",
        approvalId: "approval_1",
      }
    )

    expect(fixture.run.status).toBe("awaiting_approval")
    expect(fixture.run.grantDigest).toBe(GRANT.grantDigest)
    expect(fixture.run.grantExpiresAt).toBe(GRANT.grantExpiresAt)
  })
})

describe("lease lifecycle (gameplan §6)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("prepare initializes the lease and the chat freshness ceiling", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const { user, chat, userId, chatId } = createOwnerFixture()
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
      ],
    })

    const result = await prepareGenerationForChat(ctx, {
      chatId,
      requestId: "request_lease",
      model: "gpt-5",
      provider: "openai",
      latestUserMessage: {
        id: "user-2",
        role: "user",
        content: "hello",
        parts: [{ type: "text", text: "hello" }],
      },
      expectedVisibleMessageCount: 1,
    })

    const run = tables.generationRuns.find(
      (candidate) => candidate._id === result.runId
    )
    expect(run).toMatchObject({
      heartbeatAt: 1700000000000,
      leaseExpiresAt: 1700000000000 + LEASE_DURATION_MS,
      lastProgressAt: 1700000000000,
    })
    // Written once at prepare — the ceiling no legitimate run outlives.
    expect(chat.liveRunFreshUntil).toBeGreaterThan(1700000000000)
    expect(chat.statusRunId).toBe(result.runId)
  })

  it("heartbeat renews only worker-executing statuses and extends the run only", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const fixture = createGenerationRunLinkageFixture()
    fixture.chat.statusRunId = fixture.runId
    const { ctx, patches } = createMutationCtx(fixture.tables)

    const result = await heartbeatGenerationRunForChat(
      ctx,
      await runOwner(ctx, fixture.runId)
    )

    expect(result).toEqual({
      kind: "renewed",
      leaseExpiresAt: 1700000000000 + LEASE_DURATION_MS,
    })
    expect(fixture.run.heartbeatAt).toBe(1700000000000)
    expect(fixture.run.leaseExpiresAt).toBe(1700000000000 + LEASE_DURATION_MS)
    // Never touches the chat doc (§18 #4).
    expect(patches.filter((patch) => patch.id === fixture.chatId)).toEqual([])
  })

  it("heartbeat returns paused on the approval pause and lost on a terminal run", async () => {
    const paused = createGenerationRunLinkageFixture()
    paused.run.status = "awaiting_approval"
    const pausedCtx = createMutationCtx(paused.tables)
    expect(
      await heartbeatGenerationRunForChat(
        pausedCtx.ctx,
        await runOwner(pausedCtx.ctx, paused.runId)
      )
    ).toEqual({ kind: "paused" })
    expect(paused.run.heartbeatAt).toBeUndefined()

    const settled = createGenerationRunLinkageFixture()
    settled.run.status = "aborted"
    const settledCtx = createMutationCtx(settled.tables)
    expect(
      await heartbeatGenerationRunForChat(
        settledCtx.ctx,
        await runOwner(settledCtx.ctx, settled.runId)
      )
    ).toEqual({ kind: "lost", reason: "terminal" })
  })

  it("heartbeat returns lost when a newer run owns the chat status slot", async () => {
    const fixture = createGenerationRunLinkageFixture()
    fixture.chat.statusRunId = fixture.otherRunId
    const { ctx } = createMutationCtx(fixture.tables)

    expect(
      await heartbeatGenerationRunForChat(ctx, await runOwner(ctx, fixture.runId))
    ).toEqual({ kind: "lost", reason: "not-owner" })
    expect(fixture.run.heartbeatAt).toBeUndefined()
  })

  it("terminal transitions shed the lease; the approval pause sheds it and stamps its expiry", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const aborted = createGenerationRunLinkageFixture()
    aborted.run.heartbeatAt = 1
    aborted.run.leaseExpiresAt = 2
    const abortedCtx = createMutationCtx(aborted.tables)
    await markGenerationRunAbortedForChat(
      abortedCtx.ctx,
      await runOwner(abortedCtx.ctx, aborted.runId),
      { messageId: aborted.messageId, reason: "user stop" }
    )
    expect(aborted.run.heartbeatAt).toBeUndefined()
    expect(aborted.run.leaseExpiresAt).toBeUndefined()

    const paused = createGenerationRunLinkageFixture()
    paused.run.heartbeatAt = 1
    paused.run.leaseExpiresAt = 2
    paused.chat.statusRunId = paused.runId
    const pausedCtx = createMutationCtx(paused.tables)
    await createToolApprovalRequestForChat(
      pausedCtx.ctx,
      await runOwner(pausedCtx.ctx, paused.runId),
      {
        assistantMessageId: paused.messageId,
        toolCallId: "call_1",
        toolName: "send_email",
        source: "mcp",
        riskClass: "destructive",
        approvalId: "approval_1",
      }
    )
    expect(paused.run.heartbeatAt).toBeUndefined()
    expect(paused.run.leaseExpiresAt).toBeUndefined()
    const approval = paused.tables.toolApprovalRequests[0]
    expect(approval.expiresAt).toBe(1700000000000 + APPROVAL_EXPIRY_MS)
    // The pause's freshness ceiling becomes the approval's own expiry.
    expect(paused.chat.liveRunFreshUntil).toBe(approval.expiresAt)
  })
})

describe("reapers (gameplan §6, PR 3)", () => {
  const NOW = 1700000000000

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function makeExpiredStreamingFixture() {
    const fixture = createGenerationRunLinkageFixture()
    fixture.chat.statusRunId = fixture.runId
    fixture.chat.liveRunStatus = "streaming"
    fixture.chat.liveRunFreshUntil = NOW + 1
    fixture.run.grantDigest = "d".repeat(64)
    fixture.run.grantExpiresAt = NOW + 400_000
    fixture.run.heartbeatAt = NOW - 60_000
    fixture.run.leaseExpiresAt = NOW - 15_000
    fixture.message.content = "partial answer"
    fixture.message.parts = [{ type: "text", text: "partial answer" }]
    return fixture
  }

  it("fails an expired streaming run: lease_expired, partial content preserved, chat projection cleared", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW)
    const fixture = makeExpiredStreamingFixture()
    const { ctx } = createMutationCtx(fixture.tables)

    const result = await reapExpiredGenerationRunsPass(ctx)

    expect(result).toEqual({ reaped: 1 })
    expect(fixture.run).toMatchObject({
      status: "failed",
      terminalReason: "lease_expired",
      heartbeatAt: undefined,
      leaseExpiresAt: undefined,
      // Absorbing outcome → grant revoked.
      grantDigest: undefined,
      grantExpiresAt: undefined,
    })
    // Honest failure, content intact.
    expect(fixture.message.status).toBe("failed")
    expect(fixture.message.content).toBe("partial answer")
    // The owner's chat projection cleared and marked failed.
    expect(fixture.chat.liveRunStatus).toBeUndefined()
    expect(fixture.chat.liveRunFreshUntil).toBeUndefined()
    expect(fixture.chat.lastRunStatus).toBe("failed")
  })

  it("never matches fresh leases, lease-less rows, or the approval pause", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW)
    const fresh = createGenerationRunLinkageFixture()
    fresh.run.leaseExpiresAt = NOW + 30_000

    // A pre-heartbeat row: active-looking, NO lease fields (race #36).
    const legacy = createGenerationRun({
      id: "run_legacy",
      chatId: fresh.chatId,
      userId: fresh.userId,
      status: "streaming",
    })
    // A paused run holds no lease and must never be lease-reaped.
    const paused = createGenerationRun({
      id: "run_paused",
      chatId: fresh.chatId,
      userId: fresh.userId,
      status: "awaiting_approval",
    })
    fresh.tables.generationRuns.push(legacy, paused)
    const { ctx } = createMutationCtx(fresh.tables)

    const result = await reapExpiredGenerationRunsPass(ctx)

    expect(result).toEqual({ reaped: 0 })
    expect(fresh.run.status).toBe("streaming")
    expect(legacy.status).toBe("streaming")
    expect(paused.status).toBe("awaiting_approval")
  })

  it("a reaped run cannot clear a newer owner's chat projection", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW)
    const fixture = makeExpiredStreamingFixture()
    // A newer run claimed the slot; the reaped run's projection must no-op.
    fixture.chat.statusRunId = fixture.otherRunId
    const { ctx } = createMutationCtx(fixture.tables)

    await reapExpiredGenerationRunsPass(ctx)

    expect(fixture.run.status).toBe("failed")
    expect(fixture.chat.liveRunStatus).toBe("streaming")
    expect(fixture.chat.liveRunFreshUntil).toBe(NOW + 1)
  })

  it("settles the reaped run's pending approvals and active tool records", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW)
    const fixture = makeExpiredStreamingFixture()
    fixture.tables.toolApprovalRequests.push({
      _id: asId<"toolApprovalRequests">("approval_request_1"),
      _creationTime: 1,
      chatId: fixture.chatId,
      runId: fixture.runId,
      assistantMessageId: fixture.messageId,
      userId: fixture.userId,
      toolCallId: "call_1",
      toolName: "send_email",
      source: "mcp",
      riskClass: "destructive",
      approvalId: "approval_1",
      status: "pending",
      createdAt: 1,
      expiresAt: NOW + 1000,
    })
    fixture.tables.toolInvocations.push({
      _id: asId<"toolInvocations">("tool_invocation_1"),
      _creationTime: 1,
      runId: fixture.runId,
      chatId: fixture.chatId,
      messageId: fixture.messageId,
      toolCallId: "call_1",
      toolName: "send_email",
      source: "mcp",
      status: "called",
      createdAt: 1,
      updatedAt: 1,
    })
    const { ctx } = createMutationCtx(fixture.tables)

    await reapExpiredGenerationRunsPass(ctx)

    expect(fixture.tables.toolApprovalRequests[0]).toMatchObject({
      status: "expired",
      resolvedAt: NOW,
    })
    expect(fixture.tables.toolInvocations[0]).toMatchObject({
      status: "failed",
      completedAt: NOW,
    })
  })

  it("expires an unattended approval pause: approval_expired on the paused run", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW)
    const fixture = createGenerationRunLinkageFixture()
    fixture.chat.statusRunId = fixture.runId
    fixture.run.status = "awaiting_approval"
    fixture.message.content = "content tail"
    fixture.message.parts = [{ type: "text", text: "content tail" }]
    fixture.tables.toolApprovalRequests.push({
      _id: asId<"toolApprovalRequests">("approval_request_1"),
      _creationTime: 1,
      chatId: fixture.chatId,
      runId: fixture.runId,
      assistantMessageId: fixture.messageId,
      userId: fixture.userId,
      toolCallId: "call_1",
      toolName: "send_email",
      source: "mcp",
      riskClass: "destructive",
      approvalId: "approval_1",
      status: "pending",
      createdAt: 1,
      expiresAt: NOW - 1,
    })
    const { ctx } = createMutationCtx(fixture.tables)

    const result = await reapExpiredToolApprovalsPass(ctx)

    expect(result).toEqual({ expired: 1 })
    expect(fixture.tables.toolApprovalRequests[0]).toMatchObject({
      status: "expired",
      resolvedAt: NOW,
    })
    expect(fixture.run).toMatchObject({
      status: "failed",
      terminalReason: "approval_expired",
    })
    expect(fixture.message.content).toBe("content tail")
  })

  it("the approval reaper never touches unexpired or expiry-less pending approvals", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW)
    const fixture = createGenerationRunLinkageFixture()
    fixture.run.status = "awaiting_approval"
    fixture.tables.toolApprovalRequests.push(
      {
        _id: asId<"toolApprovalRequests">("approval_request_fresh"),
        _creationTime: 1,
        chatId: fixture.chatId,
        runId: fixture.runId,
        assistantMessageId: fixture.messageId,
        userId: fixture.userId,
        toolCallId: "call_fresh",
        toolName: "send_email",
        source: "mcp",
        riskClass: "destructive",
        approvalId: "approval_fresh",
        status: "pending",
        createdAt: 1,
        expiresAt: NOW + 60_000,
      },
      {
        // Pre-expiry-field row: undefined must be excluded, not treated as
        // instantly expired (undefined < now in index order — race #36).
        _id: asId<"toolApprovalRequests">("approval_request_legacy"),
        _creationTime: 1,
        chatId: fixture.chatId,
        runId: fixture.runId,
        assistantMessageId: fixture.messageId,
        userId: fixture.userId,
        toolCallId: "call_legacy",
        toolName: "send_email",
        source: "mcp",
        riskClass: "destructive",
        approvalId: "approval_legacy",
        status: "pending",
        createdAt: 1,
      }
    )
    const { ctx } = createMutationCtx(fixture.tables)

    const result = await reapExpiredToolApprovalsPass(ctx)

    expect(result).toEqual({ expired: 0 })
    expect(
      fixture.tables.toolApprovalRequests.map((approval) => approval.status)
    ).toEqual(["pending", "pending"])
    expect(fixture.run.status).toBe("awaiting_approval")
  })
})

describe("approval-continuation idempotency (gameplan §10, PR 8)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function makePausedWorld() {
    const fixture = createApprovalContinuationFixture([
      {
        approvalId: "approval_1",
        approved: true,
        toolCallId: "call_1",
        toolName: "read_file",
      },
    ])
    const { user, chat } = fixture.owner
    const tables: Partial<TableDocuments> = {
      ...fixture.tables,
      users: [user],
      chats: [chat],
    }
    return { fixture, user, chat, tables }
  }

  it("exactly one continuation run: the second prepare gets the typed conflict", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const { fixture, chat, tables } = makePausedWorld()
    const { ctx, tables: world } = createMutationCtx(tables)

    const first = await prepareGenerationForChat(ctx, {
      chatId: chat._id,
      requestId: "request_continuation_1",
      model: "gpt-5",
      provider: "openai",
      approvalResponses: fixture.responses,
    })

    const pausedRun = world.generationRuns.find(
      (run) => run._id === fixture.run._id
    )
    const continuationRun = world.generationRuns.find(
      (run) => run._id === first.runId
    )
    expect(pausedRun?.continuationRunId).toBe(first.runId)
    expect(continuationRun?.continuedFromRunId).toBe(fixture.run._id)

    // The losing tab's auto-send re-prepares with the same (now-resolved)
    // approval state — rejected with the typed conflict, creating nothing.
    await expect(
      prepareGenerationForChat(ctx, {
        chatId: chat._id,
        requestId: "request_continuation_2",
        model: "gpt-5",
        provider: "openai",
        approvalResponses: fixture.responses,
      })
    ).rejects.toThrow("Approval continuation already dispatched")
    expect(pausedRun?.continuationRunId).toBe(first.runId)
  })

  it("a late continuation cannot resurrect a Stop-settled pause (race #16)", async () => {
    // The user approved (the click resolved the approval row), then Stopped
    // before the auto-send POST landed: the Stop aborted the pause. The late
    // continuation prepare must CONFLICT — not create a new streaming run
    // linked to the aborted pause, re-claim the chat slot, and repaint the
    // Stop-settled assistant message back to streaming.
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const { fixture, chat, tables } = makePausedWorld()
    fixture.run.status = "aborted"
    fixture.run.terminalReason = "user_stop"
    for (const approval of fixture.tables.toolApprovalRequests ?? []) {
      approval.status = "approved"
      approval.resolvedAt = 1699999999000
    }
    const { ctx, tables: world } = createMutationCtx(tables)
    const runCountBefore = world.generationRuns.length

    await expect(
      prepareGenerationForChat(ctx, {
        chatId: chat._id,
        requestId: "request_late_continuation",
        model: "gpt-5",
        provider: "openai",
        approvalResponses: fixture.responses,
      })
    ).rejects.toThrow("Approval pause already settled")

    // The pause keeps its Stop terminal and never records a continuation.
    // (Real Convex also rolls back this transaction's interim writes; the
    // fake ctx only proves the typed conflict fired before any commit.)
    expect(fixture.run.status).toBe("aborted")
    expect(fixture.run.continuationRunId).toBeUndefined()
    expect(world.generationRuns.length).toBeGreaterThanOrEqual(runCountBefore)
  })

  it("a continuation whose pause lost the chat slot to a newer run conflicts (no supersede of the healthy run)", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const { fixture, chat, tables } = makePausedWorld()
    // A newer, healthy run owns the chat's status slot.
    chat.statusRunId = asId<"generationRuns">("run_newer")

    const { ctx } = createMutationCtx(tables)

    await expect(
      prepareGenerationForChat(ctx, {
        chatId: chat._id,
        requestId: "request_displaced_continuation",
        model: "gpt-5",
        provider: "openai",
        approvalResponses: fixture.responses,
      })
    ).rejects.toThrow("Approval pause no longer owns the chat's active run")
  })
})

describe("pending-only approval resolution (gameplan §10, PR 8)", () => {
  it("a conflicting second decision returns the canonical result instead of overwriting", async () => {
    const { user, chat, userId, chatId } = createOwnerFixture()
    const approval: Doc<"toolApprovalRequests"> = {
      _id: asId<"toolApprovalRequests">("approval_request_1"),
      _creationTime: 1,
      chatId,
      runId: asId<"generationRuns">("run_1"),
      assistantMessageId: asId<"messages">("message_1"),
      userId,
      toolCallId: "call_1",
      toolName: "send_email",
      source: "mcp",
      riskClass: "destructive",
      approvalId: "approval_1",
      status: "approved",
      resolvedAt: 500,
      resolvedByUserId: userId,
      createdAt: 1,
    }
    const { ctx } = createMutationCtx({
      users: [user],
      chats: [chat],
      toolApprovalRequests: [approval],
    })

    // The late deny must NOT repaint the earlier approve.
    const result = await resolveToolCallDecision(
      ctx,
      { approvalId: "approval_1", reason: "changed my mind" },
      "denied"
    )
    expect(result).toEqual({ status: "approved", alreadyResolved: true })
    expect(approval.status).toBe("approved")
    expect(approval.resolvedAt).toBe(500)

    // A pending approval resolves normally.
    approval.status = "pending"
    const fresh = await resolveToolCallDecision(
      ctx,
      { approvalId: "approval_1" },
      "denied"
    )
    expect(fresh).toEqual({ status: "denied", alreadyResolved: false })
    expect(approval.status).toBe("denied")
  })

  it("a decision racing in after expiresAt settles the row expired — never approves expired work", async () => {
    const { user, chat, userId, chatId } = createOwnerFixture()
    const NOW = 1700000000000
    vi.spyOn(Date, "now").mockReturnValue(NOW)
    const approval: Doc<"toolApprovalRequests"> = {
      _id: asId<"toolApprovalRequests">("approval_request_1"),
      _creationTime: 1,
      chatId,
      runId: asId<"generationRuns">("run_1"),
      assistantMessageId: asId<"messages">("message_1"),
      userId,
      toolCallId: "call_1",
      toolName: "send_email",
      source: "mcp",
      riskClass: "destructive",
      approvalId: "approval_1",
      status: "pending",
      createdAt: 1,
      expiresAt: NOW - 1,
    }
    const { ctx } = createMutationCtx({
      users: [user],
      chats: [chat],
      toolApprovalRequests: [approval],
    })

    const result = await resolveToolCallDecision(
      ctx,
      { approvalId: "approval_1" },
      "approved"
    )
    expect(result).toMatchObject({ status: "expired", alreadyResolved: true })
    expect(approval.status).toBe("expired")
    expect(approval.resolvedAt).toBe(NOW)
  })
})

describe("stopGenerationRun (gameplan §9, PR 6)", () => {
  const NOW = 1700000000000

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function makeStoppableFixture() {
    const fixture = createGenerationRunLinkageFixture()
    fixture.chat.statusRunId = fixture.runId
    fixture.chat.liveRunStatus = "streaming"
    fixture.chat.liveRunFreshUntil = NOW + 100_000
    fixture.run.grantDigest = "d".repeat(64)
    fixture.run.grantExpiresAt = NOW + 400_000
    fixture.run.heartbeatAt = NOW - 5_000
    fixture.run.leaseExpiresAt = NOW + 40_000
    fixture.message.content = "partial answer"
    fixture.message.parts = [{ type: "text", text: "partial answer" }]
    return fixture
  }

  it("stops the exact run: user_stop, audit, content preserved, approvals denied, tools settled", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW)
    const fixture = makeStoppableFixture()
    fixture.tables.toolApprovalRequests.push({
      _id: asId<"toolApprovalRequests">("approval_request_1"),
      _creationTime: 1,
      chatId: fixture.chatId,
      runId: fixture.runId,
      assistantMessageId: fixture.messageId,
      userId: fixture.userId,
      toolCallId: "call_1",
      toolName: "send_email",
      source: "mcp",
      riskClass: "destructive",
      approvalId: "approval_1",
      status: "pending",
      createdAt: 1,
      expiresAt: NOW + 1000,
    })
    fixture.tables.toolInvocations.push(
      {
        _id: asId<"toolInvocations">("tool_invocation_1"),
        _creationTime: 1,
        runId: fixture.runId,
        chatId: fixture.chatId,
        messageId: fixture.messageId,
        toolCallId: "call_1",
        toolName: "send_email",
        source: "mcp",
        status: "pending_approval",
        createdAt: 1,
        updatedAt: 1,
      },
      {
        _id: asId<"toolInvocations">("tool_invocation_2"),
        _creationTime: 1,
        runId: fixture.runId,
        chatId: fixture.chatId,
        messageId: fixture.messageId,
        toolCallId: "call_2",
        toolName: "web_search",
        source: "builtin",
        status: "completed",
        createdAt: 1,
        updatedAt: 1,
      }
    )
    const { ctx } = createMutationCtx(fixture.tables)

    const result = await stopGenerationRunForChat(ctx, {
      user: fixture.user,
      chat: fixture.chat,
      run: fixture.run,
    })

    expect(result).toEqual({
      outcome: "stopped",
      status: "aborted",
      terminalReason: "user_stop",
    })
    expect(fixture.run).toMatchObject({
      status: "aborted",
      terminalReason: "user_stop",
      stopRequestedAt: NOW,
      stopRequestedBy: fixture.userId,
      grantDigest: undefined,
      leaseExpiresAt: undefined,
    })
    expect(fixture.message.status).toBe("aborted")
    expect(fixture.message.content).toBe("partial answer")
    expect(fixture.tables.toolApprovalRequests[0]).toMatchObject({
      status: "denied",
      resolvedByUserId: fixture.userId,
    })
    // pending_approval → denied; completed evidence untouched.
    expect(
      fixture.tables.toolInvocations.map((invocation) => invocation.status)
    ).toEqual(["denied", "completed"])
    expect(fixture.chat.liveRunStatus).toBeUndefined()
    expect(fixture.chat.liveRunFreshUntil).toBeUndefined()
  })

  it("is idempotent: the second Stop returns the canonical terminal result", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW)
    const fixture = makeStoppableFixture()
    const { ctx } = createMutationCtx(fixture.tables)
    const owner = {
      user: fixture.user,
      chat: fixture.chat,
      run: fixture.run,
    }

    await stopGenerationRunForChat(ctx, owner)
    const second = await stopGenerationRunForChat(ctx, owner)

    expect(second).toEqual({
      outcome: "already-terminal",
      status: "aborted",
      terminalReason: "user_stop",
    })
  })

  it("returns not-current for a run that lost the chat slot — the newer owner is never touched", async () => {
    const fixture = makeStoppableFixture()
    fixture.chat.statusRunId = fixture.otherRunId
    const newerRun = createGenerationRun({
      id: "run_2",
      chatId: fixture.chatId,
      userId: fixture.userId,
      assistantMessageId: fixture.otherMessageId,
    })
    fixture.tables.generationRuns.push(newerRun)
    const { ctx } = createMutationCtx(fixture.tables)

    const result = await stopGenerationRunForChat(ctx, {
      user: fixture.user,
      chat: fixture.chat,
      run: fixture.run,
    })

    expect(result.outcome).toBe("not-current")
    expect(fixture.run.status).toBe("streaming")
    expect(newerRun.status).toBe("streaming")
  })
})

describe("updateAssistantSnapshotForChat", () => {
  it("persists the snapshot and keeps the run/message streaming while the run is active", async () => {
    const fixture = createGenerationRunLinkageFixture()
    const { ctx, inserts } = createMutationCtx(fixture.tables)

    await updateAssistantSnapshotForChat(ctx, await runOwner(ctx, fixture.runId), {
      messageId: fixture.messageId,
      order: 1,
      sequence: 1,
      textSnapshot: "partial",
      partsSnapshot: [{ type: "text", text: "partial" }],
    })

    expect(inserts).toHaveLength(1)
    expect(fixture.message.content).toBe("partial")
    expect(fixture.message.status).toBe("streaming")
    expect(fixture.run.status).toBe("streaming")
  })

  it("rejects late lower-sequence snapshots BEFORE insertion", async () => {
    // PR 2 (gameplan §10 "Snapshot sequencing"): the run's
    // lastSnapshotSequence is the authority, checked pre-insert — a stale
    // write leaves neither a snapshot row nor a doc patch behind.
    const fixture = createGenerationRunLinkageFixture()
    fixture.message.content = "newer"
    fixture.message.parts = [{ type: "text", text: "newer" }]
    fixture.run.lastSnapshotSequence = 2
    const { ctx, inserts, patches } = createMutationCtx(fixture.tables)

    const result = await updateAssistantSnapshotForChat(
      ctx,
      await runOwner(ctx, fixture.runId),
      {
        messageId: fixture.messageId,
        order: 1,
        sequence: 1,
        textSnapshot: "stale",
        partsSnapshot: [{ type: "text", text: "stale" }],
      }
    )

    expect(result).toEqual({ kind: "stale", lastSequence: 2 })
    expect(inserts).toEqual([])
    expect(patches).toEqual([])
    expect(fixture.message.content).toBe("newer")
    expect(fixture.message.parts).toEqual([{ type: "text", text: "newer" }])
  })

  it("rejects an equal-sequence duplicate before insertion", async () => {
    const fixture = createGenerationRunLinkageFixture()
    fixture.run.lastSnapshotSequence = 3
    const { ctx, inserts } = createMutationCtx(fixture.tables)

    const result = await updateAssistantSnapshotForChat(
      ctx,
      await runOwner(ctx, fixture.runId),
      {
        messageId: fixture.messageId,
        order: 1,
        sequence: 3,
        textSnapshot: "dup",
        partsSnapshot: [{ type: "text", text: "dup" }],
      }
    )

    expect(result).toEqual({ kind: "stale", lastSequence: 3 })
    expect(inserts).toEqual([])
  })

  it("records the accepted sequence and progress on the run", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const fixture = createGenerationRunLinkageFixture()
    const { ctx } = createMutationCtx(fixture.tables)

    const result = await updateAssistantSnapshotForChat(
      ctx,
      await runOwner(ctx, fixture.runId),
      {
        messageId: fixture.messageId,
        order: 1,
        sequence: 5,
        textSnapshot: "partial",
        partsSnapshot: [{ type: "text", text: "partial" }],
      }
    )

    expect(result).toEqual({ kind: "applied" })
    expect(fixture.run.lastSnapshotSequence).toBe(5)
    expect(fixture.run.lastProgressAt).toBe(1700000000000)
    vi.restoreAllMocks()
  })

  it("lands content on an awaiting_approval pause WITHOUT repainting it streaming", async () => {
    // The pause is lease-free (gameplan §6): the same worker's post-pause
    // final flush must land the content tail, but flipping the run back to
    // "streaming" without a lease would strand it outside both liveness
    // regimes — no lease for the run reaper, no pending status for the
    // approval reaper — a permanent zombie if the completion downgrade never
    // arrives.
    const fixture = createGenerationRunLinkageFixture()
    fixture.run.status = "awaiting_approval"
    fixture.run.heartbeatAt = undefined
    fixture.run.leaseExpiresAt = undefined
    fixture.message.status = "awaiting_approval"
    const { ctx, inserts } = createMutationCtx(fixture.tables)

    const result = await updateAssistantSnapshotForChat(
      ctx,
      await runOwner(ctx, fixture.runId),
      {
        messageId: fixture.messageId,
        order: 1,
        sequence: 4,
        textSnapshot: "tail after pause",
        partsSnapshot: [{ type: "text", text: "tail after pause" }],
      }
    )

    expect(result).toEqual({ kind: "applied" })
    expect(inserts).toHaveLength(1)
    expect(fixture.message.content).toBe("tail after pause")
    expect(fixture.message.status).toBe("awaiting_approval")
    expect(fixture.run.status).toBe("awaiting_approval")
    expect(fixture.run.lastSnapshotSequence).toBe(4)
    expect(fixture.run.leaseExpiresAt).toBeUndefined()
  })

  it("becomes a no-op once the run is terminal (post-Stop write storm)", async () => {
    // A streamer that lost the abort/supersede race must not keep inserting
    // snapshots or patching the run/message docs — that write pressure is what
    // OCC-starved the next turn's prepareGeneration after a Stop.
    const fixture = createGenerationRunLinkageFixture()
    fixture.run.status = "aborted"
    const { ctx, inserts, patches } = createMutationCtx(fixture.tables)

    await updateAssistantSnapshotForChat(ctx, await runOwner(ctx, fixture.runId), {
      messageId: fixture.messageId,
      order: 1,
      sequence: 2,
      textSnapshot: "late write",
      partsSnapshot: [{ type: "text", text: "late write" }],
    })

    expect(inserts).toEqual([])
    expect(patches).toEqual([])
    expect(fixture.message.content).toBe("")
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
          // Absorbing outcome: the grant revokes and the lease sheds in the
          // same transaction (gameplan §0 amendment 2 / §6 step 6).
          grantDigest: undefined,
          grantExpiresAt: undefined,
          heartbeatAt: undefined,
          leaseExpiresAt: undefined,
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

  it("does not repaint a run a racing Stop already aborted (zombie-repaint fix)", async () => {
    // The paused run was settled aborted by a user Stop before the approval
    // continuation landed. Resolving the approvals must NOT flip the aborted run
    // back to completed — the Generation run lifecycle's approvals-resolved rule
    // ignores an already-terminal run.
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const fixture = createApprovalContinuationFixture([
      {
        approvalId: "approval_1",
        approved: true,
        toolCallId: "call_1",
        toolName: "read_file",
      },
    ])
    fixture.run.status = "aborted"
    fixture.run.completedAt = 1699999999999
    fixture.run.activeStreamId = undefined
    const { ctx, patches } = createMutationCtx(fixture.tables)

    await applyApprovalResponses(ctx, fixture.owner, fixture.responses)

    expect(fixture.run).toMatchObject({
      status: "aborted",
      completedAt: 1699999999999,
    })
    // The run is left untouched — no close patch fires against the settled run.
    expect(patches.filter((patch) => patch.id === fixture.run._id)).toEqual([])
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

describe("chat status projection", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("claims the chat's status slot at run start (streaming + statusRunId)", async () => {
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
    const { ctx } = createMutationCtx({ users: [user], chats: [chat], messages })

    const result = await prepareGenerationForChat(ctx, {
      chatId,
      requestId: "request_followup",
      model: "gpt-5",
      provider: "openai",
      expectedVisibleMessageCount: 2,
      tailMessageId: "message_assistant_1",
      latestUserMessage: {
        id: "user-2",
        role: "user",
        content: "next prompt",
        parts: [{ type: "text", text: "next prompt" }],
      },
    })

    // Claimed AFTER the (no-op here) supersede pass, so the new run owns the slot.
    expect(chat).toMatchObject({
      liveRunStatus: "streaming",
      statusRunId: result.runId,
    })
  })

  it("projects awaiting when the owning run requests a tool approval", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const fixture = createGenerationRunLinkageFixture()
    // Simulate the run-start claim: this run owns the chat's status slot.
    fixture.chat.statusRunId = fixture.runId
    fixture.chat.liveRunStatus = "streaming"
    const { ctx } = createMutationCtx(fixture.tables)

    await createToolApprovalRequestForChat(
      ctx,
      await runOwner(ctx, fixture.runId),
      {
        assistantMessageId: fixture.messageId,
        toolCallId: "call_1",
        toolName: "send_email",
        source: "mcp",
        riskClass: "destructive",
        approvalId: "approval_1",
      }
    )

    expect(fixture.chat.liveRunStatus).toBe("awaiting")
    expect(fixture.chat.statusRunId).toBe(fixture.runId)
  })

  it("clears live and writes the completed mirror when the owning run completes", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const fixture = createGenerationRunLinkageFixture()
    fixture.chat.statusRunId = fixture.runId
    fixture.chat.liveRunStatus = "streaming"
    const { ctx } = createMutationCtx(fixture.tables)

    await markGenerationRunCompletedForChat(
      ctx,
      await runOwner(ctx, fixture.runId),
      {
        messageId: fixture.messageId,
        content: "done",
        parts: [{ type: "text", text: "done" }],
      }
    )

    expect(fixture.chat.liveRunStatus).toBeUndefined()
    expect(fixture.chat).toMatchObject({
      lastRunStatus: "completed",
      lastRunEndedAt: 1700000000000,
    })
    // statusRunId is KEPT after a terminal so a same-run convergence still applies.
    expect(fixture.chat.statusRunId).toBe(fixture.runId)
  })

  it("writes the failed mirror when the owning run fails", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const fixture = createGenerationRunLinkageFixture()
    fixture.chat.statusRunId = fixture.runId
    fixture.chat.liveRunStatus = "streaming"
    const { ctx } = createMutationCtx(fixture.tables)

    await markGenerationRunFailedForChat(
      ctx,
      await runOwner(ctx, fixture.runId),
      { messageId: fixture.messageId, error: "provider rejected" }
    )

    expect(fixture.chat.liveRunStatus).toBeUndefined()
    expect(fixture.chat).toMatchObject({
      lastRunStatus: "failed",
      lastRunEndedAt: 1700000000000,
    })
  })

  it("leaves the mirror unchanged on abort (aborted carries no signal)", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const fixture = createGenerationRunLinkageFixture()
    fixture.chat.statusRunId = fixture.runId
    fixture.chat.liveRunStatus = "streaming"
    // A prior, already-seen completed run left a mirror.
    fixture.chat.lastRunEndedAt = 1699999999000
    fixture.chat.lastRunStatus = "completed"
    const { ctx } = createMutationCtx(fixture.tables)

    await markGenerationRunAbortedForChat(
      ctx,
      await runOwner(ctx, fixture.runId),
      { messageId: fixture.messageId, reason: "stream aborted" }
    )

    // Only the live phase clears; the terminal mirror is untouched (a user Stop
    // must not strand a stale unread, and it writes no new signal).
    expect(fixture.chat.liveRunStatus).toBeUndefined()
    expect(fixture.chat).toMatchObject({
      lastRunEndedAt: 1699999999000,
      lastRunStatus: "completed",
    })
  })

  it("ignores a terminal projection from a run that no longer owns the slot (run-id guard)", async () => {
    // Race (review round 4, #1): run A completes, the user starts run B (which
    // claims the slot and projects streaming), then A's late `fail` lands. The
    // lifecycle lets fail overwrite completed, so A's run transition is real —
    // but the guard must keep it from clobbering B's live row.
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const { user, chat, userId, chatId } = createOwnerFixture()
    const runAId = asId<"generationRuns">("run_a")
    const runBId = asId<"generationRuns">("run_b")
    const messageAId = asId<"messages">("message_a")
    const runA = createGenerationRun({
      id: runAId,
      chatId,
      userId,
      assistantMessageId: messageAId,
      status: "completed",
    })
    const messageA = createAssistantRuntimeMessage({
      id: messageAId,
      chatId,
      runId: runAId,
      orderId: 1,
      status: "completed",
      content: "A answer",
      parts: [{ type: "text", text: "A answer" }],
    })
    // Run B has claimed the chat's status slot.
    chat.statusRunId = runBId
    chat.liveRunStatus = "streaming"
    const { ctx } = createMutationCtx({
      users: [user],
      chats: [chat],
      messages: [messageA],
      generationRuns: [runA],
    })

    await markGenerationRunFailedForChat(ctx, await runOwner(ctx, runAId), {
      messageId: messageAId,
      error: "late failure",
    })

    // A's run itself transitions to failed (fail may overwrite completed)...
    expect(runA.status).toBe("failed")
    // ...but B still owns the row: the guard made A's projection a no-op.
    expect(chat).toMatchObject({
      liveRunStatus: "streaming",
      statusRunId: runBId,
    })
    expect(chat.lastRunStatus).toBeUndefined()
  })
})
