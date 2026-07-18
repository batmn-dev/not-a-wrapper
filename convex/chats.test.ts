import { describe, expect, it } from "vitest"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx } from "./_generated/server"
import {
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
