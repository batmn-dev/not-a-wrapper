import { describe, expect, it } from "vitest"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx } from "./_generated/server"
import {
  applyGeneratedTitleForOwnedChat,
  createChatWithFirstTurnForUser,
  getPinnedForCurrentUserHandler,
  getProjectChatDirectoryForProject,
  getPublicByIdHandler,
  getRecentWindowForCurrentUserHandler,
  listForCurrentUserPaginatedHandler,
  markChatReadForOwner,
  PROJECT_CHAT_PREVIEW_SCAN_LIMIT,
  projectChatForReader,
  removeChatForOwner,
  searchByTitleForCurrentUserHandler,
  selectProjectChatPreview,
} from "./chats"

type ChatQueryCtx = Parameters<typeof getPinnedForCurrentUserHandler>[0]

type QueryBuilder = {
  eq: (fieldName: string, value: unknown) => QueryBuilder
}

type FilterBuilder = {
  eq: (fieldName: unknown, value: unknown) => boolean
  field: (fieldName: string) => string
}

function asId<Table extends "users" | "chats" | "projects" | "messages">(
  value: string
): Id<Table> {
  return value as Id<Table>
}

describe("project conversation previews", () => {
  it("uses the newest visible conversational message and bounds its payload", () => {
    const longContent = `Newest   preview\n${"x".repeat(400)}`
    const preview = selectProjectChatPreview([
      { role: "assistant", content: "abandoned branch", selected: false },
      { role: "data", content: "internal data", selected: true },
      { role: "user", content: longContent, selected: true },
      { role: "assistant", content: "older visible", selected: true },
    ])

    expect(preview).toMatch(/^Newest preview x+/)
    expect(preview).toHaveLength(320)
  })

  it("projects one bounded message tail per owner-checked project chat", async () => {
    const user = createUser("owner")
    const project: Doc<"projects"> = {
      _id: asId<"projects">("project-1"),
      _creationTime: 1,
      userId: user._id,
      name: "Investing",
    }
    const older = createChat({
      _id: asId<"chats">("older"),
      userId: user._id,
      projectId: project._id,
      updatedAt: 10,
    })
    const newer = createChat({
      _id: asId<"chats">("newer"),
      userId: user._id,
      projectId: project._id,
      updatedAt: 20,
    })
    const previewMessages = new Map<string, Array<Partial<Doc<"messages">>>>([
      [newer._id, [{ role: "user", content: "newer preview", selected: true }]],
      [
        older._id,
        [{ role: "assistant", content: "older preview", selected: true }],
      ],
    ])
    const messageReads: Array<{ chatId: string; limit: number }> = []

    const ctx = {
      db: {
        query: (tableName: "chats" | "messages") => {
          if (tableName === "chats") {
            return {
              withIndex: (
                indexName: string,
                buildQuery: (query: QueryBuilder) => unknown
              ) => {
                expect(indexName).toBe("by_project")
                const query: QueryBuilder = {
                  eq: (_field, value) => {
                    expect(value).toBe(project._id)
                    return query
                  },
                }
                buildQuery(query)
                let chats = [older, newer]
                const resultApi = {
                  filter: (
                    buildFilter: (filter: FilterBuilder) => unknown
                  ) => {
                    let fieldName = ""
                    let expected: unknown
                    buildFilter({
                      field: (field) => {
                        fieldName = field
                        return field
                      },
                      eq: (_field, value) => {
                        expected = value
                        return true
                      },
                    })
                    chats = chats.filter(
                      (chat) =>
                        (chat as unknown as Record<string, unknown>)[
                          fieldName
                        ] === expected
                    )
                    return resultApi
                  },
                  collect: async () => chats,
                }
                return resultApi
              },
            }
          }

          let selectedChatId = ""
          const resultApi = {
            withIndex: (
              indexName: string,
              buildQuery: (query: QueryBuilder) => unknown
            ) => {
              expect(indexName).toBe("by_chat_order")
              const query: QueryBuilder = {
                eq: (_field, value) => {
                  selectedChatId = String(value)
                  return query
                },
              }
              buildQuery(query)
              return resultApi
            },
            order: (direction: string) => {
              expect(direction).toBe("desc")
              return resultApi
            },
            take: async (limit: number) => {
              messageReads.push({ chatId: selectedChatId, limit })
              return previewMessages.get(selectedChatId) ?? []
            },
          }
          return resultApi
        },
      },
    } as unknown as Parameters<typeof getProjectChatDirectoryForProject>[0]

    const result = await getProjectChatDirectoryForProject(ctx, project)

    expect(result.map(({ chat, preview }) => [chat._id, preview])).toEqual([
      [newer._id, "newer preview"],
      [older._id, "older preview"],
    ])
    expect(messageReads).toEqual([
      { chatId: newer._id, limit: PROJECT_CHAT_PREVIEW_SCAN_LIMIT },
      { chatId: older._id, limit: PROJECT_CHAT_PREVIEW_SCAN_LIMIT },
    ])
  })
})

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

function createProject(
  id: string,
  userId: Id<"users">,
  overrides: Partial<Doc<"projects">> = {}
): Doc<"projects"> {
  return {
    _id: asId<"projects">(id),
    _creationTime: 1,
    userId,
    name: id,
    ...overrides,
  }
}

function createCtx({
  user,
  chats = [],
  projects = [],
  indexNames = [],
}: {
  user: Doc<"users"> | null
  chats?: Doc<"chats">[]
  projects?: Doc<"projects">[]
  indexNames?: string[]
}): ChatQueryCtx {
  return {
    user,
    db: {
      get: async (id: Id<"chats"> | Id<"projects">) =>
        chats.find((chat) => chat._id === id) ??
        projects.find((project) => project._id === id) ??
        null,
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

          let results = chats.filter((chat) => {
            const record = chat as unknown as Record<string, unknown>
            for (const [fieldName, value] of filters) {
              if (record[fieldName] !== value) return false
            }
            return true
          })

          const resultApi = {
            filter: (buildFilter: (filter: FilterBuilder) => unknown) => {
              let fieldName = ""
              let expected: unknown
              buildFilter({
                field: (field) => {
                  fieldName = field
                  return field
                },
                eq: (_field, value) => {
                  expected = value
                  return true
                },
              })
              results = results.filter(
                (chat) =>
                  (chat as unknown as Record<string, unknown>)[fieldName] ===
                  expected
              )
              return resultApi
            },
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
    const activeProject = createProject("project-1", user._id)
    const deletingProject = createProject("project-2", user._id, {
      deletingAt: 2,
    })
    const indexNames: string[] = []

    const result = await getPinnedForCurrentUserHandler(
      createCtx({
        user,
        indexNames,
        projects: [activeProject, deletingProject],
        chats: [
          createChat({ _id: asId<"chats">("personal"), userId: user._id }),
          createChat({
            _id: asId<"chats">("project"),
            userId: user._id,
            projectId: activeProject._id,
          }),
          createChat({
            _id: asId<"chats">("deleting-project"),
            userId: user._id,
            projectId: deletingProject._id,
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
          createChat({
            _id: asId<"chats">("deleting"),
            userId: user._id,
            deletingAt: 2,
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

describe("getPublicByIdHandler", () => {
  it("returns null for a tombstoned public chat", async () => {
    const user = createUser("user-1")
    const chat = createChat({
      _id: asId<"chats">("deleting-public"),
      userId: user._id,
      public: true,
      deletingAt: 2,
    })
    const ctx = createCtx({ user: null, chats: [chat] })

    await expect(
      getPublicByIdHandler(ctx, { chatId: chat._id })
    ).resolves.toBeNull()
  })

  it("returns null when the public Chat's Project is tombstoned", async () => {
    const user = createUser("user-1")
    const project = createProject("project-1", user._id, { deletingAt: 2 })
    const chat = createChat({
      _id: asId<"chats">("project-public"),
      userId: user._id,
      projectId: project._id,
      public: true,
    })
    const ctx = createCtx({
      user: null,
      chats: [chat],
      projects: [project],
    })

    await expect(
      getPublicByIdHandler(ctx, { chatId: chat._id })
    ).resolves.toBeNull()
  })
})

describe("getRecentWindowForCurrentUserHandler", () => {
  it("paginates project and non-project chats in one recency window", async () => {
    const user = createUser("user-1")
    const activeProject = createProject("project-1", user._id)
    const deletingProject = createProject("project-2", user._id, {
      deletingAt: 2,
    })
    const indexNames: string[] = []

    const result = await getRecentWindowForCurrentUserHandler(
      createCtx({
        user,
        indexNames,
        projects: [activeProject, deletingProject],
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
            projectId: activeProject._id,
            updatedAt: 2,
          }),
          createChat({
            _id: asId<"chats">("deleting-project"),
            userId: user._id,
            pinned: false,
            projectId: deletingProject._id,
            updatedAt: 4,
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

describe("searchByTitleForCurrentUserHandler", () => {
  it("filters matches whose parent Project is tombstoned", async () => {
    const user = createUser("user-1")
    const activeProject = createProject("project-active", user._id)
    const deletingProject = createProject("project-deleting", user._id, {
      deletingAt: 2,
    })
    const active = createChat({
      _id: asId<"chats">("active"),
      userId: user._id,
      projectId: activeProject._id,
      title: "Research",
    })
    const hidden = createChat({
      _id: asId<"chats">("hidden"),
      userId: user._id,
      projectId: deletingProject._id,
      title: "Research archive",
    })
    const projects = [activeProject, deletingProject]
    const resultApi = {
      filter: () => resultApi,
      take: async () => [active, hidden],
    }
    const ctx = {
      user,
      db: {
        get: async (id: Id<"projects">) =>
          projects.find((project) => project._id === id) ?? null,
        query: () => ({
          withSearchIndex: (
            indexName: string,
            buildQuery: (query: {
              search: (fieldName: string, term: string) => unknown
              eq: (fieldName: string, value: unknown) => unknown
            }) => unknown
          ) => {
            expect(indexName).toBe("by_title")
            const query = {
              search: (fieldName: string, term: string) => {
                expect(fieldName).toBe("title")
                expect(term).toBe("Research")
                return query
              },
              eq: (fieldName: string, value: unknown) => {
                expect(fieldName).toBe("userId")
                expect(value).toBe(user._id)
                return query
              },
            }
            buildQuery(query)
            return resultApi
          },
        }),
      },
    } as unknown as ChatQueryCtx

    await expect(
      searchByTitleForCurrentUserHandler(ctx, " Research ")
    ).resolves.toEqual([active])
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
    "liveRunFreshUntil",
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
      liveRunFreshUntil: 330_000,
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
  function createReadWriteCtx(
    chats: Doc<"chats">[],
    projects: Doc<"projects">[] = []
  ) {
    const patches: Array<{ id: string; value: Record<string, unknown> }> = []
    const ctx = {
      db: {
        get: async (id: string) =>
          chats.find((chat) => chat._id === id) ??
          projects.find((project) => project._id === id) ??
          null,
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

  it("no-ops when the owned Chat's Project is tombstoned", async () => {
    const owner = createUser("owner")
    const project = createProject("project-1", owner._id, { deletingAt: 2 })
    const chat = createChat({
      _id: asId<"chats">("c1"),
      userId: owner._id,
      projectId: project._id,
      lastRunEndedAt: 200,
    })
    const { ctx, patches } = createReadWriteCtx([chat], [project])

    await markChatReadForOwner(ctx, owner, chat._id, 200)

    expect(patches).toEqual([])
    expect(chat.lastReadAt).toBeUndefined()
  })
})

// Atomic first-turn creation (createChatWithFirstTurnForUser).
//
// Scope honesty: this array-backed fake has NO transaction semantics, so these
// tests do NOT (and cannot) prove rollback — the chat-row rollback on a thrown
// validation error is Convex's mutation transactionality, taken as a platform
// guarantee. What IS proved here: the handler's composition (chat + binding +
// message + return shape) and the validate-all-before-any-patch ordering that
// makes the rolled-back transaction contain no partial binding writes.
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
      get: async (id: string) =>
        allDocs().find((doc) => doc._id === id) ?? null,
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
      titleSource: "provisional",
      titleGeneration: 1,
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

  it("commits only the current provisional title generation", async () => {
    const { ctx, tables } = createFirstTurnHarness([])
    const result = await createChatWithFirstTurnForUser(ctx, user, {
      title: "New chat",
      message: { clientMessageId: "optimistic-1", text: "hello" },
      attachmentIds: [],
    })
    const chat = tables.chats.find(
      (candidate) => candidate._id === result.chatId
    )! as Doc<"chats">

    await expect(
      applyGeneratedTitleForOwnedChat(ctx, chat, {
        title: "Stale title",
        generation: 2,
      })
    ).resolves.toBe(false)
    expect(chat.title).toBe("New chat")

    await expect(
      applyGeneratedTitleForOwnedChat(ctx, chat, {
        title: "Greeting Exchange",
        generation: 1,
      })
    ).resolves.toBe(true)
    expect(chat).toMatchObject({
      title: "Greeting Exchange",
      titleSource: "generated",
      titleGeneration: 1,
    })

    chat.title = "My custom name"
    chat.titleSource = "user"
    await expect(
      applyGeneratedTitleForOwnedChat(ctx, chat, {
        title: "Late model result",
        generation: 1,
      })
    ).resolves.toBe(false)
    expect(chat.title).toBe("My custom name")
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

describe("removeChatForOwner", () => {
  it("tombstones and schedules without synchronously reading or deleting children", async () => {
    const owner = createUser("owner")
    const chat = createChat({
      _id: asId<"chats">("chat-1"),
      userId: owner._id,
      public: true,
      liveRunStatus: "streaming",
      liveRunFreshUntil: 500,
      statusRunId: "run-1" as Id<"generationRuns">,
    })
    const messages = [{ _id: "message-1", chatId: chat._id }]
    const jobs: Array<Record<string, unknown>> = []
    const scheduled: Array<{ delay: number; args: unknown }> = []
    const deleted: string[] = []
    const ctx = {
      chat,
      user: owner,
      db: {
        get: async (id: string) => {
          if (id === chat._id) return chat
          return jobs.find((job) => job._id === id) ?? null
        },
        patch: async (id: string, patch: Record<string, unknown>) => {
          expect(id).toBe(chat._id)
          const chatRecord = chat as unknown as Record<string, unknown>
          for (const [field, value] of Object.entries(patch)) {
            if (value === undefined) {
              delete chatRecord[field]
            } else {
              chatRecord[field] = value
            }
          }
        },
        insert: async (tableName: string, value: Record<string, unknown>) => {
          expect(tableName).toBe("deletionJobs")
          const id = "job-1"
          jobs.push({ _id: id, _creationTime: 1, ...value })
          return id
        },
        delete: async (id: string) => deleted.push(id),
        query: (tableName: string) => {
          expect(tableName).toBe("deletionJobs")
          const resultApi = {
            withIndex: (
              indexName: string,
              build: (query: {
                eq: (field: string, value: unknown) => unknown
              }) => unknown
            ) => {
              expect(indexName).toBe("by_chat")
              const query = {
                eq: (field: string, value: unknown) => {
                  expect(field).toBe("chatId")
                  expect(value).toBe(chat._id)
                  return query
                },
              }
              build(query)
              return resultApi
            },
            filter: () => resultApi,
            first: async () => null,
          }
          return resultApi
        },
      },
      scheduler: {
        runAfter: async (delay: number, _fn: unknown, args: unknown) => {
          scheduled.push({ delay, args })
          return "scheduled-id"
        },
      },
      storage: {},
      meta: {},
    } as unknown as MutationCtx & {
      chat: Doc<"chats">
      user: Doc<"users">
    }

    await removeChatForOwner(ctx)

    expect(chat).toMatchObject({
      deletingAt: expect.any(Number),
      public: false,
    })
    expect(chat.liveRunStatus).toBeUndefined()
    expect(chat.liveRunFreshUntil).toBeUndefined()
    expect(chat.statusRunId).toBeUndefined()
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({
      targetKind: "chat",
      chatId: chat._id,
      state: "pending",
      phase: "assistantMessageSnapshots",
    })
    expect(scheduled).toEqual([
      { delay: 0, args: { jobId: "job-1" } },
    ])
    expect(messages).toEqual([{ _id: "message-1", chatId: chat._id }])
    expect(deleted).toEqual([])
  })
})
