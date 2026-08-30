import { describe, expect, it, vi } from "vitest"
import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"
import {
  DELETION_BATCH,
  ensureChatDeletionJob,
  ensureProjectDeletionJob,
  runDeletionBatchImpl,
} from "./chat_deletion"

type TableName =
  | "users"
  | "projects"
  | "chats"
  | "messages"
  | "generationRuns"
  | "toolInvocations"
  | "toolApprovalRequests"
  | "toolCallLog"
  | "chatAttachments"
  | "usageReservations"
  | "deletionJobs"

type TestDocument = {
  _id: string
  _creationTime: number
  [field: string]: unknown
}

type Seed = Partial<Record<TableName, TestDocument[]>>

type Scheduled = {
  delayMs: number
  fn: unknown
  args: { jobId: Id<"deletionJobs"> }
}

const tableNames: TableName[] = [
  "users",
  "projects",
  "chats",
  "messages",
  "generationRuns",
  "toolInvocations",
  "toolApprovalRequests",
  "toolCallLog",
  "chatAttachments",
  "usageReservations",
  "deletionJobs",
]

function asId<Table extends TableName | "_storage">(
  value: string
): Id<Table> {
  return value as Id<Table>
}

function user(id = "user-1"): Doc<"users"> {
  return {
    _id: asId<"users">(id),
    _creationTime: 1,
    workosUserId: `workos-${id}`,
    email: `${id}@example.com`,
  }
}

function project(id: string): Doc<"projects"> {
  return {
    _id: asId<"projects">(id),
    _creationTime: 1,
    userId: asId<"users">("user-1"),
    name: id,
    updatedAt: 10,
    pinned: false,
    deletingAt: 20,
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
    deletingAt: 20,
  }
}

function row(id: string, fields: Record<string, unknown> = {}): TestDocument {
  return { _id: id, _creationTime: 1, ...fields }
}

function createHarness(
  seed: Seed,
  options: { failStorageId?: Id<"_storage"> } = {}
) {
  const tables = Object.fromEntries(
    tableNames.map((tableName) => [tableName, [...(seed[tableName] ?? [])]])
  ) as Record<TableName, TestDocument[]>
  const scheduled: Scheduled[] = []
  const deletedStorageIds: Id<"_storage">[] = []
  const operations: string[] = []
  const paginateCallsByStep: number[] = []
  const paginatedPages: Array<{
    tableName: TableName
    cursor: string | null
    ids: string[]
  }> = []
  let paginateCalls = 0
  let nextId = 1

  const find = (id: string) => {
    for (const tableName of tableNames) {
      const document = tables[tableName].find((entry) => entry._id === id)
      if (document) return { document, tableName }
    }
    return null
  }

  const matches = (
    document: TestDocument,
    filters: Map<string, { operator: "eq" | "neq"; value: unknown }>
  ) =>
    [...filters].every(([fieldName, { operator, value }]) =>
      operator === "eq"
        ? document[fieldName] === value
        : document[fieldName] !== value
    )

  const ctx = {
    db: {
      get: async (id: string) => find(id)?.document ?? null,
      insert: async (
        tableName: TableName,
        value: Record<string, unknown>
      ) => {
        const id = `${tableName}-${nextId++}`
        tables[tableName].push({
          _id: id,
          _creationTime: nextId,
          ...value,
        })
        operations.push(`insert:${id}`)
        return id
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        const found = find(id)
        if (!found) throw new Error(`Missing test document: ${id}`)
        for (const [field, value] of Object.entries(patch)) {
          if (value === undefined) delete found.document[field]
          else found.document[field] = value
        }
        operations.push(`patch:${id}`)
      },
      delete: async (id: string) => {
        const found = find(id)
        if (!found) throw new Error(`Missing test document: ${id}`)
        tables[found.tableName] = tables[found.tableName].filter(
          (entry) => entry._id !== id
        )
        operations.push(`delete:${id}`)
      },
      query: (tableName: TableName) => ({
        withIndex: (
          _indexName: string,
          buildQuery: (query: {
            eq: (fieldName: string, value: unknown) => unknown
          }) => unknown
        ) => {
          const filters = new Map<
            string,
            { operator: "eq" | "neq"; value: unknown }
          >()
          const query = {
            eq: (fieldName: string, value: unknown) => {
              filters.set(fieldName, { operator: "eq", value })
              return query
            },
          }
          buildQuery(query)

          const resultApi = {
            order: () => resultApi,
            filter: (
              buildFilter: (query: {
                field: (fieldName: string) => string
                neq: (fieldName: unknown, value: unknown) => boolean
              }) => unknown
            ) => {
              let fieldName = ""
              buildFilter({
                field: (field) => {
                  fieldName = field
                  return field
                },
                neq: (_field, value) => {
                  filters.set(fieldName, { operator: "neq", value })
                  return true
                },
              })
              return resultApi
            },
            take: async (limit: number) =>
              tables[tableName]
                .filter((document) => matches(document, filters))
                .slice(0, limit),
            first: async () =>
              tables[tableName].find((document) =>
                matches(document, filters)
              ) ?? null,
            unique: async () => {
              const matching = tables[tableName].filter((document) =>
                matches(document, filters)
              )
              expect(matching.length).toBeLessThanOrEqual(1)
              return matching[0] ?? null
            },
            collect: async () =>
              tables[tableName].filter((document) =>
                matches(document, filters)
              ),
            paginate: async ({
              cursor,
              numItems,
            }: {
              cursor: string | null
              numItems: number
            }) => {
              paginateCalls++
              if (paginateCalls > 1) {
                throw new Error(
                  "This query or mutation function ran multiple paginated queries. Convex only supports a single paginated query in each function."
                )
              }
              const matching = tables[tableName].filter((document) =>
                matches(document, filters)
              )
              const page = matching.slice(0, numItems)
              paginatedPages.push({
                tableName,
                cursor,
                ids: page.map((document) => document._id),
              })
              return {
                page,
                isDone: page.length >= matching.length,
                continueCursor: String(page.length),
              }
            },
          }
          return resultApi
        },
      }),
    },
    storage: {
      delete: vi.fn(async (storageId: Id<"_storage">) => {
        if (storageId === options.failStorageId) {
          throw new Error("storage unavailable")
        }
        deletedStorageIds.push(storageId)
        operations.push(`storage:${storageId}`)
      }),
    },
    scheduler: {
      runAfter: async (
        delayMs: number,
        fn: unknown,
        args: { jobId: Id<"deletionJobs"> }
      ) => {
        scheduled.push({ delayMs, fn, args })
        return "scheduled-id"
      },
    },
    meta: {},
  } as unknown as MutationCtx

  const runStep = async (jobId: Id<"deletionJobs">) => {
    paginateCalls = 0
    await runDeletionBatchImpl(ctx, jobId)
    paginateCallsByStep.push(paginateCalls)
  }

  const pump = async () => {
    let steps = 0
    while (scheduled.length > 0) {
      const next = scheduled.shift()
      if (!next) break
      expect(next.delayMs).toBe(0)
      await runStep(next.args.jobId)
      steps++
      if (steps > 200) throw new Error("Deletion pump did not converge")
    }
  }

  const schedule = (jobId: Id<"deletionJobs">) => {
    scheduled.push({ delayMs: 0, fn: "runDeletionBatch", args: { jobId } })
  }

  return {
    ctx,
    tables,
    scheduled,
    deletedStorageIds,
    operations,
    paginateCallsByStep,
    paginatedPages,
    runStep,
    pump,
    schedule,
  }
}

function activeJob(harness: ReturnType<typeof createHarness>) {
  return harness.tables.deletionJobs[0] as unknown as Doc<"deletionJobs">
}

describe("asynchronous Chat deletion", () => {
  it("drains the full graph, deletes exclusive storage, and preserves shared data", async () => {
    const owner = user()
    const chatDoc = chat("chat-1")
    const otherChat = chat("chat-2")
    const exclusiveStorage = asId<"_storage">("storage-exclusive")
    const sharedStorage = asId<"_storage">("storage-shared")
    const harness = createHarness({
      users: [owner as unknown as TestDocument],
      chats: [
        chatDoc as unknown as TestDocument,
        otherChat as unknown as TestDocument,
      ],
      toolInvocations: [row("invocation-1", { chatId: chatDoc._id })],
      toolApprovalRequests: [
        row("approval-1", { chatId: chatDoc._id, status: "pending" }),
      ],
      toolCallLog: [row("log-1", { chatId: chatDoc._id })],
      messages: [
        row("message-1", { chatId: chatDoc._id }),
        row("other-message", { chatId: otherChat._id }),
      ],
      generationRuns: [row("run-1", { chatId: chatDoc._id })],
      chatAttachments: [
        row("exclusive-attachment", {
          chatId: chatDoc._id,
          storageId: exclusiveStorage,
        }),
        row("shared-attachment", {
          chatId: chatDoc._id,
          storageId: sharedStorage,
        }),
        row("shared-survivor", {
          chatId: otherChat._id,
          storageId: sharedStorage,
        }),
      ],
    })
    const job = await ensureChatDeletionJob(harness.ctx, chatDoc, owner)
    harness.schedule(job._id)

    await harness.pump()

    expect(activeJob(harness).state).toBe("complete")
    expect(
      (
        [
          "toolInvocations",
          "toolApprovalRequests",
          "toolCallLog",
          "messages",
          "generationRuns",
          "chatAttachments",
        ] as const
      ).flatMap((tableName) =>
        harness.tables[tableName].filter(
          (document) => document.chatId === chatDoc._id
        )
      )
    ).toEqual([])
    expect(harness.tables.chats.map((document) => document._id)).toEqual([
      otherChat._id,
    ])
    expect(harness.deletedStorageIds).toEqual([exclusiveStorage])
    expect(harness.tables.chatAttachments.map((row) => row._id)).toEqual([
      "shared-survivor",
    ])
  })

  it("drains an oversized child range from cursor:null across bounded batches", async () => {
    const owner = user()
    const chatDoc = chat("chat-1")
    const invocations = Array.from({ length: 1_000 }, (_, index) =>
      row(`invocation-${index}`, { chatId: chatDoc._id })
    )
    const harness = createHarness({
      users: [owner as unknown as TestDocument],
      chats: [chatDoc as unknown as TestDocument],
      toolInvocations: invocations,
    })
    const job = await ensureChatDeletionJob(harness.ctx, chatDoc, owner)
    harness.schedule(job._id)

    await harness.pump()

    expect(activeJob(harness).state).toBe("complete")
    expect(activeJob(harness).batchesProcessed).toBeGreaterThanOrEqual(5)
    expect(harness.paginateCallsByStep.every((count) => count <= 1)).toBe(true)
    expect(
      harness.paginateCallsByStep.filter((count) => count > 0).every(
        (count) => count === 1
      )
    ).toBe(true)
    const invocationPages = harness.paginatedPages.filter(
      (page) => page.tableName === "toolInvocations"
    )
    expect(invocationPages.every((page) => page.cursor === null)).toBe(true)
    expect(invocationPages.slice(0, 5).map((page) => page.ids[0])).toEqual([
      "invocation-0",
      `invocation-${DELETION_BATCH.numItems}`,
      `invocation-${DELETION_BATCH.numItems * 2}`,
      `invocation-${DELETION_BATCH.numItems * 3}`,
      `invocation-${DELETION_BATCH.numItems * 4}`,
    ])
  })

  it("is idempotent when the same job is invoked again after progress", async () => {
    const owner = user()
    const chatDoc = chat("chat-1")
    const harness = createHarness({
      users: [owner as unknown as TestDocument],
      chats: [chatDoc as unknown as TestDocument],
      toolInvocations: [row("invocation-1", { chatId: chatDoc._id })],
    })
    const job = await ensureChatDeletionJob(harness.ctx, chatDoc, owner)

    await harness.runStep(job._id)
    await harness.runStep(job._id)

    expect(activeJob(harness).documentsDeleted).toBe(1)
    expect(activeJob(harness).batchesProcessed).toBe(2)
    expect(harness.tables.toolInvocations).toEqual([])
  })

  it("exits silently for a stale invocation after completion", async () => {
    const owner = user()
    const chatDoc = chat("chat-1")
    const harness = createHarness({
      users: [owner as unknown as TestDocument],
      chats: [chatDoc as unknown as TestDocument],
    })
    const job = await ensureChatDeletionJob(harness.ctx, chatDoc, owner)
    harness.schedule(job._id)
    await harness.pump()
    const completed = { ...activeJob(harness) }
    const scheduledBefore = harness.scheduled.length

    await expect(harness.runStep(job._id)).resolves.toBeUndefined()

    expect(activeJob(harness)).toEqual(completed)
    expect(harness.scheduled).toHaveLength(scheduledBefore)
  })

  it("converts a storage failure to blocked without clearing the tombstone", async () => {
    const owner = user()
    const chatDoc = chat("chat-1")
    const storageId = asId<"_storage">("storage-failing")
    const harness = createHarness(
      {
        users: [owner as unknown as TestDocument],
        chats: [chatDoc as unknown as TestDocument],
        chatAttachments: [
          row("attachment-1", { chatId: chatDoc._id, storageId }),
        ],
      },
      { failStorageId: storageId }
    )
    const job = await ensureChatDeletionJob(harness.ctx, chatDoc, owner)
    harness.schedule(job._id)

    await harness.pump()

    expect(activeJob(harness)).toMatchObject({
      state: "blocked",
      failureCode: "storage_delete_failed",
      retryCount: 1,
    })
    expect(harness.scheduled).toEqual([])
    expect(harness.tables.chats[0]).toMatchObject({
      _id: chatDoc._id,
      deletingAt: 20,
    })
  })

  it("serially drains Project chats and deletes the Project root last", async () => {
    const owner = user()
    const projectDoc = project("project-1")
    const chats = ["chat-1", "chat-2", "chat-3"].map((id) =>
      chat(id, projectDoc._id)
    )
    for (const chatDoc of chats) delete chatDoc.deletingAt
    const oversizedInvocations = Array.from({ length: 450 }, (_, index) =>
      row(`invocation-${index}`, { chatId: chats[1]?._id })
    )
    const harness = createHarness({
      users: [owner as unknown as TestDocument],
      projects: [projectDoc as unknown as TestDocument],
      chats: chats as unknown as TestDocument[],
      toolInvocations: oversizedInvocations,
    })
    const job = await ensureProjectDeletionJob(
      harness.ctx,
      projectDoc,
      owner
    )
    harness.schedule(job._id)

    await harness.pump()

    expect(activeJob(harness).state).toBe("complete")
    expect(harness.tables.chats).toEqual([])
    expect(harness.tables.projects).toEqual([])
    for (const chatDoc of chats) {
      expect(
        harness.operations.some(
          (operation) => operation === `patch:${chatDoc._id}`
        )
      ).toBe(true)
    }
    expect(harness.operations.at(-2)).toBe(`delete:${projectDoc._id}`)
    expect(harness.paginateCallsByStep.every((count) => count <= 1)).toBe(true)
  })

  it("defers a live child run before Project deletion removes it", async () => {
    const owner = user()
    const projectDoc = project("project-1")
    const chatDoc = chat("chat-1", projectDoc._id)
    delete chatDoc.deletingAt
    const runId = asId<"generationRuns">("run-1")
    const messageId = asId<"messages">("message-1")
    const harness = createHarness({
      users: [owner as unknown as TestDocument],
      projects: [projectDoc as unknown as TestDocument],
      chats: [chatDoc as unknown as TestDocument],
      generationRuns: [
        row(runId, {
          chatId: chatDoc._id,
          userId: owner._id,
          requestId: "request-1",
          model: "gpt-5-mini",
          provider: "openai",
          status: "streaming",
          assistantMessageId: messageId,
          workStartedAt: 10,
          grantDigest: "digest-1",
          cancellationSettlementVersion: 1,
          updatedAt: 10,
        }),
      ],
      messages: [
        row(messageId, {
          chatId: chatDoc._id,
          role: "assistant",
          status: "streaming",
          content: "partial",
          parts: [{ type: "text", text: "partial" }],
          orderId: 1,
          createdAt: 10,
          updatedAt: 10,
          generationRunId: runId,
        }),
      ],
      usageReservations: [
        row("reservation-1", {
          userId: owner._id,
          requestId: "request-1",
          bucketId: "bucket-1",
          generationRunId: runId,
          chatId: chatDoc._id,
          modelId: "gpt-5-mini",
          routeId: "gpt-5-mini",
          providerId: "openai",
          status: "reserved",
          estimatedCredits: 100_000,
          estimatedInputTokens: 1_000,
          estimatedOutputTokens: 8_192,
          reservedCredits: 100_000,
          cancellationSettlementVersion: 1,
          providerMayHaveStarted: true,
          pricingSnapshot: {
            revision: "rev-1",
            currency: "USD",
            primary: {
              modelId: "gpt-5-mini",
              routeId: "gpt-5-mini",
              providerId: "openai",
              upstreamModelId: "gpt-5-mini",
              inputCreditsPerMTok: 750_000,
              outputCreditsPerMTok: 4_500_000,
            },
          },
          payloadFingerprint: "fp",
          reservedAt: 1,
          updatedAt: 1,
        }),
      ],
    })
    const job = await ensureProjectDeletionJob(harness.ctx, projectDoc, owner)
    harness.schedule(job._id)

    await harness.pump()

    expect(harness.tables.generationRuns).toEqual([])
    expect(harness.tables.usageReservations[0]).toMatchObject({
      status: "reserved",
      terminalPendingAt: expect.any(Number),
      settlementDeadlineAt: expect.any(Number),
      settlementGrantDigest: "digest-1",
      providerMayHaveStarted: true,
    })
  })

  it("returns the existing active job for a second delete request", async () => {
    const owner = user()
    const chatDoc = chat("chat-1")
    const harness = createHarness({
      users: [owner as unknown as TestDocument],
      chats: [chatDoc as unknown as TestDocument],
    })

    const first = await ensureChatDeletionJob(harness.ctx, chatDoc, owner)
    const second = await ensureChatDeletionJob(harness.ctx, chatDoc, owner)

    expect(second._id).toBe(first._id)
    expect(harness.tables.deletionJobs).toHaveLength(1)
  })

  it("regresses chatRoot to a newly observed child range", async () => {
    const owner = user()
    const chatDoc = chat("chat-1")
    const harness = createHarness({
      users: [owner as unknown as TestDocument],
      chats: [chatDoc as unknown as TestDocument],
      deletionJobs: [
        row("job-1", {
          targetKind: "chat",
          chatId: chatDoc._id,
          userId: owner._id,
          state: "running",
          phase: "chatRoot",
          version: 1,
          batchesProcessed: 7,
          documentsDeleted: 0,
          bytesObserved: 0,
          retryCount: 0,
          createdAt: 1,
          updatedAt: 1,
        }),
      ],
      messages: [row("late-message", { chatId: chatDoc._id })],
    })

    await harness.runStep(asId<"deletionJobs">("job-1"))

    expect(activeJob(harness).phase).toBe("messages")
    expect(harness.tables.chats).toHaveLength(1)
    expect(harness.operations).not.toContain(`delete:${chatDoc._id}`)
  })

  it("lets overlapping Chat and Project jobs both complete without double-deleting the root", async () => {
    const owner = user()
    const projectDoc = project("project-1")
    const chatDoc = chat("chat-1", projectDoc._id)
    const harness = createHarness({
      users: [owner as unknown as TestDocument],
      projects: [projectDoc as unknown as TestDocument],
      chats: [chatDoc as unknown as TestDocument],
      messages: [row("message-1", { chatId: chatDoc._id })],
    })
    const chatJob = await ensureChatDeletionJob(harness.ctx, chatDoc, owner)
    const projectJob = await ensureProjectDeletionJob(
      harness.ctx,
      projectDoc,
      owner
    )
    harness.schedule(projectJob._id)
    harness.schedule(chatJob._id)

    await harness.pump()

    expect(
      harness.tables.deletionJobs.map((job) => job.state)
    ).toEqual(["complete", "complete"])
    expect(
      harness.operations.filter(
        (operation) => operation === `delete:${chatDoc._id}`
      )
    ).toHaveLength(1)
    expect(harness.tables.projects).toEqual([])
    expect(
      harness.tables.deletionJobs.some((job) => job.state === "blocked")
    ).toBe(false)
  })
})
