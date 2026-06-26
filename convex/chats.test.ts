import { describe, expect, it } from "vitest"
import type { Doc, Id } from "./_generated/dataModel"
import {
  getPinnedForCurrentUserHandler,
  listForCurrentUserPaginatedHandler,
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
  it("reads pinned non-project chats through the sidebar composite index", async () => {
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

    expect(indexNames).toEqual(["by_user_pinned_project_updated"])
    expect(result.map((chat) => chat._id)).toEqual(["personal"])
  })

  it("returns an empty list without subscribing when signed out", async () => {
    const indexNames: string[] = []

    await expect(
      getPinnedForCurrentUserHandler(createCtx({ user: null, indexNames }))
    ).resolves.toEqual([])
    expect(indexNames).toEqual([])
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
