import { describe, expect, it } from "vitest"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx } from "./_generated/server"
import {
  createChatWithFirstTurnForUser,
  getPinnedForCurrentUserHandler,
  getRecentWindowForCurrentUserHandler,
  listForCurrentUserPaginatedHandler,
  markChatReadForOwner,
  projectChatForReader,
} from "./chats"

type ChatQueryCtx = Parameters<typeof getPinnedForCurrentUserHandler>[0]

type QueryBuilder = {
  eq: (fieldName: string, value: unknown) => QueryBuilder
}

function asId<Table extends "users" | "chats" | "projects">(
  value: string
): Id<Table> {
  return value as Id<Table>
}

function createUser(id: string): Doc<"users"> {
  return {
    _id: asId<"users">(id),
    _creationTime: 1,
    workosUserId: `workos-${id}`,
    email: `${id}@example.com`,
  }
}

function createChat(
  overrides: Partial<Doc<"chats">> & Pick<Doc<"chats">, "_id" | "userId">
): Doc<"chats"> {
  return {
    _creationTime: 1,
    public: false,
    pinned: true,
    pinnedAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function createCtx({
  user,
  chats = [],
  indexNames = [],
}: {
  user: Doc<"users"> | null
  chats?: Doc<"chats">[]
  indexNames?: string[]
}): ChatQueryCtx {
  return {
    user,
    db: {
      query: (tableName: "chats") => ({
        withIndex: (
          indexName: string,
          buildQuery: (query: QueryBuilder) => unknown
        ) => {
          expect(tableName).toBe("chats")
          indexNames.push(indexName)

          const filters = new Map<string, unknown>()
          const query: QueryBuilder = {
            eq: (fieldName, value) => {
              filters.set(fieldName, value)
              return query
            },
          }
          buildQuery(query)

          const results = chats.filter((chat) => {
            const record = chat as unknown as Record<string, unknown>
            for (const [fieldName, value] of filters) {
              if (record[fieldName] !== value) return false
            }
            return true
          })

          const resultApi = {
            collect: async () => results,
            order: (direction: "asc" | "desc") => {
              results.sort((a, b) => {
                const comparison = a.updatedAt - b.updatedAt
                return direction === "desc" ? -comparison : comparison
              })
              return resultApi
            },
            paginate: async ({ numItems }: { numItems: number }) => ({
              page: results.slice(0, numItems),
              isDone: results.length <= numItems,
              continueCursor: results.length > numItems ? "next" : "",
            }),
          }
          return resultApi
        },
      }),
    },
  } as unknown as ChatQueryCtx
}

describe("getPinnedForCurrentUserHandler", () => {
  it("reads pinned project and non-project chats through the sidebar index", async () => {
    const user = createUser("user-1")
    const otherUser = createUser("user-2")
    const indexNames: string[] = []

    const result = await getPinnedForCurrentUserHandler(
      createCtx({
        user,
        indexNames,
        chats: [
          createChat({ _id: asId<"chats">("personal"), userId: user._id }),
          createChat({
            _id: asId<"chats">("project"),
            userId: user._id,
            projectId: asId<"projects">("project-1"),
          }),
          createChat({
            _id: asId<"chats">("unpinned"),
            userId: user._id,
            pinned: false,
            pinnedAt: undefined,
          }),
          createChat({
            _id: asId<"chats">("other-user"),
            userId: otherUser._id,
          }),
        ],
      })
    )

    expect(indexNames).toEqual(["by_user_pinned_updated"])
    expect(result.map((chat) => chat._id)).toEqual(["personal", "project"])
  })

  it("returns an empty list without subscribing when signed out", async () => {
    const indexNames: string[] = []

    await expect(
      getPinnedForCurrentUserHandler(createCtx({ user: null, indexNames }))
    ).resolves.toEqual([])
    expect(indexNames).toEqual([])
  })
})

describe("getRecentWindowForCurrentUserHandler", () => {
  it("paginates project and non-project chats in one recency window", async () => {
    const user = createUser("user-1")
    const indexNames: string[] = []

    const result = await getRecentWindowForCurrentUserHandler(
      createCtx({
        user,
        indexNames,
        chats: [
          createChat({
            _id: asId<"chats">("personal"),
            userId: user._id,
            pinned: false,
            updatedAt: 1,
          }),
          createChat({
            _id: asId<"chats">("project"),
            userId: user._id,
            pinned: false,
            projectId: asId<"projects">("project-1"),
            updatedAt: 2,
          }),
          createChat({
            _id: asId<"chats">("pinned"),
            userId: user._id,
            pinned: true,
            updatedAt: 3,
          }),
        ],
      }),
      { numItems: 10, cursor: null }
    )

    expect(indexNames).toEqual(["by_user_pinned_updated"])
    expect(result.page.map((chat) => chat._id)).toEqual(["project", "personal"])
  })
})

describe("listForCurrentUserPaginatedHandler", () => {
  it("paginates browse history over non-project chats only", async () => {
    const user = createUser("user-1")
    const indexNames: string[] = []

    const result = await listForCurrentUserPaginatedHandler(
      createCtx({
        user,
        indexNames,
        chats: [
          createChat({
            _id: asId<"chats">("project-newest"),
            userId: user._id,
            projectId: asId<"projects">("project-1"),
            updatedAt: 40,
          }),
          createChat({
            _id: asId<"chats">("personal-newest"),
            userId: user._id,
            updatedAt: 30,
          }),
          createChat({
            _id: asId<"chats">("project-second"),
            userId: user._id,
            projectId: asId<"projects">("project-1"),
            updatedAt: 20,
          }),
          createChat({
            _id: asId<"chats">("personal-older"),
            userId: user._id,
            pinned: false,
            pinnedAt: undefined,
            updatedAt: 10,
          }),
        ],
      }),
      { numItems: 2, cursor: null }
    )

    expect(indexNames).toEqual(["by_user_project_updated"])
    expect(result.page.map((chat) => chat._id)).toEqual([
      "personal-newest",
      "personal-older",
    ])
    expect(result.isDone).toBe(true)
  })

  it("returns an empty done page without subscribing when signed out", async () => {
    const indexNames: string[] = []

    await expect(
      listForCurrentUserPaginatedHandler(
        createCtx({ user: null, indexNames }),
        { numItems: 25, cursor: null }
      )
    ).resolves.toEqual({ page: [], isDone: true, continueCursor: "" })
    expect(indexNames).toEqual([])
  })
})

describe("projectChatForReader (owner-only status strip)", () => {
  const OWNER_ONLY_FIELDS = [
    "liveRunStatus",
    "statusRunId",
    "lastRunEndedAt",
    "lastRunStatus",
    "lastReadAt",
  ] as const

  function sharedChatWithStatus(): Doc<"chats"> {
    return createChat({
      _id: asId<"chats">("shared"),
      userId: asId<"users">("owner"),
      title: "shared",
      public: true,
      liveRunStatus: "streaming",
      statusRunId: "run_1" as Id<"generationRuns">,
      lastRunEndedAt: 200,
      lastRunStatus: "completed",
      lastReadAt: 100,
    })
  }

  it("returns the full doc (owner-only fields intact) for the owner", () => {
    const chat = sharedChatWithStatus()
    const result = projectChatForReader(chat, createUser("owner"))
    expect(result).toBe(chat)
    for (const field of OWNER_ONLY_FIELDS) {
      expect(result).toHaveProperty(field)
    }
  })

  it("strips owner-only status fields for a non-owner (shared-chat viewer)", () => {
    const result = projectChatForReader(
      sharedChatWithStatus(),
      createUser("viewer")
    )
    for (const field of OWNER_ONLY_FIELDS) {
      expect(result).not.toHaveProperty(field)
    }
    // Non-status fields survive.
    expect(result).toMatchObject({ public: true, title: "shared" })
  })

  it("strips for an unauthenticated public reader (no user)", () => {
    const result = projectChatForReader(sharedChatWithStatus(), null)
    for (const field of OWNER_ONLY_FIELDS) {
      expect(result).not.toHaveProperty(field)
    }
  })

  it("returns null when there is no chat", () => {
    expect(projectChatForReader(null, createUser("viewer"))).toBeNull()
  })
})

describe("markChatReadForOwner", () => {
  function createReadWriteCtx(chats: Doc<"chats">[]) {
    const patches: Array<{ id: string; value: Record<string, unknown> }> = []
    const ctx = {
      db: {
        get: async (id: string) =>
          chats.find((chat) => chat._id === id) ?? null,
        patch: async (id: string, value: Record<string, unknown>) => {
          patches.push({ id, value })
          const chat = chats.find((candidate) => candidate._id === id)
          if (chat) Object.assign(chat, value)
        },
      },
    } as unknown as Pick<MutationCtx, "db">
    return { ctx, patches }
  }

  it("stamps lastReadAt for a chat the caller owns", async () => {
    const owner = createUser("owner")
    const chat = createChat({
      _id: asId<"chats">("c1"),
      userId: owner._id,
      lastRunEndedAt: 200,
    })
    const { ctx, patches } = createReadWriteCtx([chat])

    await markChatReadForOwner(ctx, owner, chat._id, 200)

    expect(patches).toHaveLength(1)
    expect(chat.lastReadAt).toBe(200)
  })

  it("caps the read cursor at the current terminal mirror", async () => {
    const owner = createUser("owner")
    const chat = createChat({
      _id: asId<"chats">("c1"),
      userId: owner._id,
      lastRunEndedAt: 200,
    })
    const { ctx, patches } = createReadWriteCtx([chat])

    await markChatReadForOwner(ctx, owner, chat._id, 300)

    expect(patches).toEqual([{ id: chat._id, value: { lastReadAt: 200 } }])
    expect(chat.lastReadAt).toBe(200)
  })

  it("does not move lastReadAt backwards for a stale read-through", async () => {
    const owner = createUser("owner")
    const chat = createChat({
      _id: asId<"chats">("c1"),
      userId: owner._id,
      lastRunEndedAt: 300,
      lastReadAt: 250,
    })
    const { ctx, patches } = createReadWriteCtx([chat])

    await markChatReadForOwner(ctx, owner, chat._id, 200)

    expect(patches).toEqual([])
    expect(chat.lastReadAt).toBe(250)
  })

  it("no-ops when the chat has no terminal mirror", async () => {
    const owner = createUser("owner")
    const chat = createChat({ _id: asId<"chats">("c1"), userId: owner._id })
    const { ctx, patches } = createReadWriteCtx([chat])

    await markChatReadForOwner(ctx, owner, chat._id, 200)

    expect(patches).toEqual([])
    expect(chat.lastReadAt).toBeUndefined()
  })

  it("no-ops for a chat the caller does not own (opening a public chat)", async () => {
    const owner = createUser("owner")
    const viewer = createUser("viewer")
    const chat = createChat({
      _id: asId<"chats">("c1"),
      userId: owner._id,
      public: true,
    })
    const { ctx, patches } = createReadWriteCtx([chat])

    await markChatReadForOwner(ctx, viewer, chat._id, 200)

    expect(patches).toEqual([])
    expect(chat.lastReadAt).toBeUndefined()
  })

  it("no-ops for a missing chat", async () => {
    const { ctx, patches } = createReadWriteCtx([])
    await markChatReadForOwner(
      ctx,
      createUser("owner"),
      asId<"chats">("missing"),
      200
    )
    expect(patches).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Atomic first-turn creation (createChatWithFirstTurnForUser).
//
// Scope honesty: this array-backed fake has NO transaction semantics, so these
// tests do NOT (and cannot) prove rollback — the chat-row rollback on a thrown
// validation error is Convex's mutation transactionality, taken as a platform
// guarantee. What IS proved here: the handler's composition (chat + binding +
// message + return shape) and the validate-all-before-any-patch ordering that
// makes the rolled-back transaction contain no partial binding writes.
// ---------------------------------------------------------------------------

type AnyDoc = { _id: string; _creationTime: number } & Record<string, unknown>

function createFirstTurnHarness(
  seedAttachments: Array<Record<string, unknown> & { _id: string }> = []
) {
  const tables: Record<"chats" | "messages" | "chatAttachments", AnyDoc[]> = {
    chats: [],
    messages: [],
    chatAttachments: seedAttachments.map((attachment) => ({
      _creationTime: 1,
      ...attachment,
    })) as AnyDoc[],
  }
  let nextId = 1
  const allDocs = () => [
    ...tables.chats,
    ...tables.messages,
    ...tables.chatAttachments,
  ]

  const ctx = {
    db: {
      get: async (id: string) => allDocs().find((doc) => doc._id === id) ?? null,
      insert: async (
        table: keyof typeof tables,
        value: Record<string, unknown>
      ) => {
        const id = `${table}_${nextId++}`
        tables[table].push({ _id: id, _creationTime: nextId, ...value })
        return id
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        const doc = allDocs().find((candidate) => candidate._id === id)
        if (!doc) throw new Error(`Missing doc ${id}`)
        for (const [field, value] of Object.entries(patch)) {
          if (value === undefined) delete doc[field]
          else doc[field] = value
        }
      },
      query: (table: string) => {
        expect(table).toBe("messages")
        return {
          withIndex: (
            _index: string,
            build: (query: {
              eq: (field: string, value: unknown) => unknown
            }) => unknown
          ) => {
            let chatId: unknown
            const query = {
              eq: (_field: string, value: unknown) => {
                chatId = value
                return query
              },
            }
            build(query)
            return {
              collect: async () =>
                tables.messages
                  .filter((message) => message.chatId === chatId)
                  .sort(
                    (left, right) =>
                      (left.orderId as number) - (right.orderId as number)
                  ),
            }
          },
        }
      },
    },
  } as unknown as MutationCtx

  return { ctx, tables }
}

describe("createChatWithFirstTurnForUser", () => {
  const user = createUser("user_1")

  function stagedAttachment(overrides: Record<string, unknown> = {}) {
    return {
      _id: "att_1",
      userId: user._id,
      storageId: "storage_1",
      fileUrl: "https://files.test/notes.pdf",
      fileName: "notes.pdf",
      fileType: "application/pdf",
      fileSize: 10,
      stagedAt: 5,
      ...overrides,
    }
  }

  it("creates the chat, binds the staged set, and persists the first user message in one pass", async () => {
    const { ctx, tables } = createFirstTurnHarness([stagedAttachment()])

    const result = await createChatWithFirstTurnForUser(ctx, user, {
      title: "Read this",
      model: "model-1",
      systemPrompt: "system",
      message: { clientMessageId: "optimistic-1", text: "Read this" },
      attachmentIds: ["att_1" as Id<"chatAttachments">],
    })

    expect(tables.chats).toHaveLength(1)
    expect(tables.chats[0]).toMatchObject({
      _id: result.chatId,
      userId: user._id,
      title: "Read this",
      model: "model-1",
      public: false,
      pinned: false,
    })

    // The staged row is now chat-bound (no longer sweepable by the TTL job).
    expect(tables.chatAttachments[0]).toMatchObject({ chatId: result.chatId })
    expect(tables.chatAttachments[0]?.stagedAt).toBeUndefined()

    // One selected, completed user message carrying the server-built file part;
    // no provenance stamp yet (no generation request exists at creation).
    expect(tables.messages).toHaveLength(1)
    expect(tables.messages[0]).toMatchObject({
      _id: result.userMessageId,
      chatId: result.chatId,
      role: "user",
      clientMessageId: "optimistic-1",
      content: "Read this",
      orderId: 0,
      selected: true,
      status: "completed",
    })
    expect(tables.messages[0]?.requestId).toBeUndefined()
    expect(tables.messages[0]?.parts).toEqual([
      { type: "text", text: "Read this" },
      {
        type: "file",
        filename: "notes.pdf",
        mediaType: "application/pdf",
        url: "https://files.test/notes.pdf",
        attachmentId: "att_1",
      },
    ])

    expect(result.attachments).toEqual([
      {
        name: "notes.pdf",
        contentType: "application/pdf",
        url: "https://files.test/notes.pdf",
        attachmentId: "att_1",
      },
    ])
  })

  it("validates the whole set before any binding patch when it contains another user's attachment", async () => {
    const { ctx, tables } = createFirstTurnHarness([
      stagedAttachment(),
      stagedAttachment({ _id: "att_2", userId: asId<"users">("user_2") }),
    ])

    await expect(
      createChatWithFirstTurnForUser(ctx, user, {
        message: { clientMessageId: "optimistic-1", text: "Read both" },
        attachmentIds: [
          "att_1" as Id<"chatAttachments">,
          "att_2" as Id<"chatAttachments">,
        ],
      })
    ).rejects.toThrow("Attachment not found")

    // Validate-all-before-any-patch: even the caller's own attachment stays
    // unbound, and no message exists. (The chat-row rollback itself is
    // Convex's mutation transactionality — untestable in this fake and
    // deliberately not claimed by this suite.)
    expect(
      tables.chatAttachments.every((attachment) => !attachment.chatId)
    ).toBe(true)
    expect(tables.messages).toHaveLength(0)
  })

  it("rejects duplicate attachment references", async () => {
    const { ctx } = createFirstTurnHarness([stagedAttachment()])

    await expect(
      createChatWithFirstTurnForUser(ctx, user, {
        message: { clientMessageId: "optimistic-1", text: "Read this" },
        attachmentIds: [
          "att_1" as Id<"chatAttachments">,
          "att_1" as Id<"chatAttachments">,
        ],
      })
    ).rejects.toThrow("Duplicate attachment reference")
  })
})
