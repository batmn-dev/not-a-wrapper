import { describe, expect, it, vi } from "vitest"
import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"
import {
  CHAT_OWNED_DELETION_LIMIT_ERROR,
  CHAT_OWNED_DELETION_LIMITS,
  createChatOwnedDeletion,
} from "./chat_owned_deletion"

type TableName =
  | "projects"
  | "chats"
  | "messages"
  | "generationRuns"
  | "assistantMessageSnapshots"
  | "toolInvocations"
  | "toolApprovalRequests"
  | "toolCallLog"
  | "chatAttachments"

type TestDocument = {
  _id: string
  _creationTime: number
  [field: string]: unknown
}

type Seed = Partial<Record<TableName, TestDocument[]>>

const tableNames: TableName[] = [
  "projects",
  "chats",
  "messages",
  "generationRuns",
  "assistantMessageSnapshots",
  "toolInvocations",
  "toolApprovalRequests",
  "toolCallLog",
  "chatAttachments",
]

function asId<Table extends TableName | "users" | "_storage">(
  value: string
): Id<Table> {
  return value as Id<Table>
}

function project(
  id: string,
  overrides: Partial<Doc<"projects">> = {}
): Doc<"projects"> {
  return {
    _id: asId<"projects">(id),
    _creationTime: 1,
    userId: asId<"users">("user-1"),
    name: id,
    updatedAt: 10,
    ...overrides,
  }
}

function chat(
  id: string,
  projectId?: Id<"projects">
): Doc<"chats"> {
  return {
    _id: asId<"chats">(id),
    _creationTime: 1,
    userId: asId<"users">("user-1"),
    title: id,
    projectId,
    public: false,
    pinned: false,
    updatedAt: 20,
  }
}

function row(
  id: string,
  fields: Record<string, unknown> = {}
): TestDocument {
  return { _id: id, _creationTime: 1, ...fields }
}

function metric(remaining: number) {
  return { used: 0, remaining }
}

function createHarness(
  seed: Seed,
  options: {
    failStorageId?: Id<"_storage">
    documentsWrittenRemaining?: number
    bytesWrittenRemaining?: number
    beforeRangeRead?: (
      tableName: TableName,
      tables: Record<TableName, TestDocument[]>
    ) => void
  } = {}
) {
  const tables = Object.fromEntries(
    tableNames.map((tableName) => [
      tableName,
      [...(seed[tableName] ?? [])],
    ])
  ) as Record<TableName, TestDocument[]>
  const operations: string[] = []

  const find = (id: string) => {
    for (const tableName of tableNames) {
      const document = tables[tableName].find((entry) => entry._id === id)
      if (document) return { document, tableName }
    }
    return null
  }

  const deleteStoredFile = vi.fn(async (storageId: Id<"_storage">) => {
    operations.push(`storage:${storageId}`)
    if (storageId === options.failStorageId) {
      throw new Error("storage unavailable")
    }
  })
  const deleteDocument = vi.fn(async (id: string) => {
    const found = find(id)
    if (!found) return
    operations.push(`delete:${id}`)
    tables[found.tableName] = tables[found.tableName].filter(
      (entry) => entry._id !== id
    )
  })
  const patchDocument = vi.fn(
    async (id: string, patch: Record<string, unknown>) => {
      const found = find(id)
      if (!found) throw new Error(`Missing test document: ${id}`)
      operations.push(`patch:${id}`)
      Object.assign(found.document, patch)
    }
  )

  const ctx = {
    db: {
      get: async (id: string) => find(id)?.document ?? null,
      patch: patchDocument,
      delete: deleteDocument,
      query: (tableName: TableName) => ({
        withIndex: (
          _indexName: string,
          buildQuery: (query: {
            eq: (fieldName: string, value: unknown) => unknown
          }) => unknown
        ) => {
          const filters = new Map<string, unknown>()
          const query = {
            eq: (fieldName: string, value: unknown) => {
              filters.set(fieldName, value)
              return query
            },
          }
          buildQuery(query)

          return {
            paginate: async ({
              cursor,
              numItems,
            }: {
              cursor: string | null
              numItems: number
            }) => {
              options.beforeRangeRead?.(tableName, tables)
              const matching = tables[tableName].filter((document) =>
                [...filters].every(
                  ([fieldName, value]) => document[fieldName] === value
                )
              )
              const start = cursor ? Number(cursor) : 0
              const end = Math.min(start + numItems, matching.length)
              return {
                page: matching.slice(start, end),
                isDone: end >= matching.length,
                continueCursor: String(end),
              }
            },
          }
        },
      }),
    },
    storage: { delete: deleteStoredFile },
    meta: {
      getTransactionMetrics: async () => ({
        bytesRead: metric(16 * 1024 * 1024),
        bytesWritten: metric(
          options.bytesWrittenRemaining ?? 16 * 1024 * 1024
        ),
        databaseQueries: metric(4_096),
        documentsRead: metric(32_000),
        documentsWritten: metric(
          options.documentsWrittenRemaining ?? 16_000
        ),
        functionsScheduled: metric(1_000),
        scheduledFunctionArgsBytes: metric(16 * 1024 * 1024),
      }),
    },
  } as unknown as Pick<MutationCtx, "db" | "meta" | "storage">

  return {
    ctx,
    tables,
    operations,
    deleteStoredFile,
    deleteDocument,
    patchDocument,
  }
}

function idsForChat(
  tables: Record<TableName, TestDocument[]>,
  chatId: Id<"chats">
) {
  return tableNames
    .filter((tableName) => !["projects", "chats"].includes(tableName))
    .flatMap((tableName) =>
      tables[tableName]
        .filter((document) => document.chatId === chatId)
        .map((document) => document._id)
    )
}

describe("Chat-owned deletion", () => {
  it("deletes the complete Chat graph and preserves unrelated data", async () => {
    const projectDoc = project("project-1")
    const chatDoc = chat("chat-1", projectDoc._id)
    const otherChat = chat("chat-2")
    const storageId = asId<"_storage">("storage-1")
    const otherStorageId = asId<"_storage">("storage-2")
    const approvalStatuses = ["pending", "approved", "denied", "expired"]

    const harness = createHarness({
      projects: [projectDoc as unknown as TestDocument],
      chats: [
        chatDoc as unknown as TestDocument,
        otherChat as unknown as TestDocument,
      ],
      messages: [
        row("message-1", { chatId: chatDoc._id }),
        row("other-message", { chatId: otherChat._id }),
      ],
      generationRuns: [row("run-1", { chatId: chatDoc._id })],
      assistantMessageSnapshots: [
        row("snapshot-1", { chatId: chatDoc._id }),
      ],
      toolInvocations: [row("invocation-1", { chatId: chatDoc._id })],
      toolApprovalRequests: approvalStatuses.map((status) =>
        row(`approval-${status}`, { chatId: chatDoc._id, status })
      ),
      toolCallLog: [
        row("log-1", { chatId: chatDoc._id }),
        row("other-log", { chatId: otherChat._id }),
      ],
      chatAttachments: [
        row("attachment-1", { chatId: chatDoc._id, storageId }),
        row("attachment-2", { chatId: chatDoc._id, storageId }),
        row("attachment-3", { chatId: chatDoc._id }),
        row("other-attachment", {
          chatId: otherChat._id,
          storageId: otherStorageId,
        }),
      ],
    })

    await createChatOwnedDeletion(harness.ctx).deleteChat(chatDoc)

    expect(
      harness.tables.chats.map((document) => document._id)
    ).toEqual([otherChat._id])
    expect(idsForChat(harness.tables, chatDoc._id)).toEqual([])
    expect(idsForChat(harness.tables, otherChat._id).sort()).toEqual(
      ["other-attachment", "other-log", "other-message"].sort()
    )
    expect(harness.deleteStoredFile).toHaveBeenCalledTimes(1)
    expect(harness.deleteStoredFile).toHaveBeenCalledWith(storageId)
    expect(harness.deleteStoredFile).not.toHaveBeenCalledWith(otherStorageId)
    expect(harness.patchDocument).toHaveBeenCalledTimes(1)
    expect(harness.patchDocument).toHaveBeenCalledWith(
      projectDoc._id,
      expect.objectContaining({ updatedAt: expect.any(Number) })
    )

    const databaseDeletes = harness.operations.filter((operation) =>
      operation.startsWith("delete:")
    )
    expect(databaseDeletes.at(-1)).toBe(`delete:${chatDoc._id}`)
  })

  it("deletes a non-Project Chat without Project activity", async () => {
    const chatDoc = chat("chat-1")
    const harness = createHarness({
      chats: [chatDoc as unknown as TestDocument],
    })

    await createChatOwnedDeletion(harness.ctx).deleteChat(chatDoc)

    expect(harness.tables.chats).toEqual([])
    expect(harness.patchDocument).not.toHaveBeenCalled()
  })

  it("deletes all and only Project Chat graphs without touching the Project", async () => {
    const projectDoc = project("project-1")
    const otherProject = project("project-2")
    const firstChat = chat("chat-1", projectDoc._id)
    const secondChat = chat("chat-2", projectDoc._id)
    const unrelatedChat = chat("chat-3", otherProject._id)
    const harness = createHarness({
      projects: [
        projectDoc as unknown as TestDocument,
        otherProject as unknown as TestDocument,
      ],
      chats: [
        firstChat as unknown as TestDocument,
        secondChat as unknown as TestDocument,
        unrelatedChat as unknown as TestDocument,
      ],
      messages: [
        row("message-1", { chatId: firstChat._id }),
        row("message-2", { chatId: secondChat._id }),
        row("message-3", { chatId: unrelatedChat._id }),
      ],
      toolCallLog: [row("log-1", { chatId: secondChat._id })],
    })

    await createChatOwnedDeletion(harness.ctx).deleteChatsForProject(
      projectDoc
    )

    expect(harness.tables.chats.map((document) => document._id)).toEqual([
      unrelatedChat._id,
    ])
    expect(idsForChat(harness.tables, firstChat._id)).toEqual([])
    expect(idsForChat(harness.tables, secondChat._id)).toEqual([])
    expect(idsForChat(harness.tables, unrelatedChat._id)).toEqual([
      "message-3",
    ])
    expect(
      harness.tables.projects.find(
        (document) => document._id === projectDoc._id
      )?.updatedAt
    ).toBe(10)
    expect(harness.patchDocument).not.toHaveBeenCalled()
    expect(harness.deleteDocument).not.toHaveBeenCalledWith(projectDoc._id)
  })

  it("does not write database state when stored-file deletion fails", async () => {
    const projectDoc = project("project-1")
    const chatDoc = chat("chat-1", projectDoc._id)
    const storageId = asId<"_storage">("storage-1")
    const harness = createHarness(
      {
        projects: [projectDoc as unknown as TestDocument],
        chats: [chatDoc as unknown as TestDocument],
        messages: [row("message-1", { chatId: chatDoc._id })],
        chatAttachments: [
          row("attachment-1", { chatId: chatDoc._id, storageId }),
        ],
      },
      { failStorageId: storageId }
    )

    await expect(
      createChatOwnedDeletion(harness.ctx).deleteChat(chatDoc)
    ).rejects.toThrow("storage unavailable")

    expect(harness.tables.chats).toHaveLength(1)
    expect(idsForChat(harness.tables, chatDoc._id).sort()).toEqual(
      ["attachment-1", "message-1"].sort()
    )
    expect(harness.deleteDocument).not.toHaveBeenCalled()
    expect(harness.patchDocument).not.toHaveBeenCalled()
  })

  it("fails before writes when a Project exceeds the atomic Chat limit", async () => {
    const projectDoc = project("project-1")
    const chats = Array.from(
      { length: CHAT_OWNED_DELETION_LIMITS.projectChats + 1 },
      (_, index) => chat(`chat-${index}`, projectDoc._id)
    )
    const harness = createHarness({
      projects: [projectDoc as unknown as TestDocument],
      chats: chats as unknown as TestDocument[],
    })

    await expect(
      createChatOwnedDeletion(harness.ctx).deleteChatsForProject(projectDoc)
    ).rejects.toThrow(CHAT_OWNED_DELETION_LIMIT_ERROR)

    expect(harness.tables.chats).toHaveLength(chats.length)
    expect(harness.deleteStoredFile).not.toHaveBeenCalled()
    expect(harness.deleteDocument).not.toHaveBeenCalled()
  })

  it("honors live transaction headroom before writing", async () => {
    const chatDoc = chat("chat-1")
    const harness = createHarness(
      { chats: [chatDoc as unknown as TestDocument] },
      {
        documentsWrittenRemaining:
          CHAT_OWNED_DELETION_LIMITS.transactionDocumentReserve,
      }
    )

    await expect(
      createChatOwnedDeletion(harness.ctx).deleteChat(chatDoc)
    ).rejects.toThrow(CHAT_OWNED_DELETION_LIMIT_ERROR)

    expect(harness.tables.chats).toHaveLength(1)
    expect(harness.deleteDocument).not.toHaveBeenCalled()
  })

  it("includes a late owned write before that indexed range is read", async () => {
    const chatDoc = chat("chat-1")
    let inserted = false
    const harness = createHarness(
      {
        chats: [chatDoc as unknown as TestDocument],
        messages: [row("message-1", { chatId: chatDoc._id })],
      },
      {
        beforeRangeRead: (tableName, tables) => {
          if (inserted || tableName !== "messages") return
          inserted = true
          tables.toolCallLog.push(
            row("late-log", { chatId: chatDoc._id })
          )
        },
      }
    )

    await createChatOwnedDeletion(harness.ctx).deleteChat(chatDoc)

    expect(inserted).toBe(true)
    expect(harness.tables.toolCallLog).toEqual([])
  })
})
