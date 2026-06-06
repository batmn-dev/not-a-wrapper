import { describe, expect, it } from "vitest"
import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"
import {
  getAuthorizedChatForRead,
  getCurrentUser,
  requireCurrentUser,
  requireOwnedChat,
  requireOwnedProject,
} from "./auth"

type QueryBuilder = {
  eq: (fieldName: string, value: unknown) => QueryBuilder
}

function asId<Table extends "users" | "chats" | "projects">(
  value: string
): Id<Table> {
  return value as Id<Table>
}

function createUser(id: string, workosUserId: string): Doc<"users"> {
  return {
    _id: asId<"users">(id),
    _creationTime: 1,
    workosUserId,
    email: `${workosUserId}@example.com`,
  }
}

function createChat(
  id: string,
  userId: Id<"users">,
  isPublic = false
): Doc<"chats"> {
  return {
    _id: asId<"chats">(id),
    _creationTime: 1,
    userId,
    public: isPublic,
    pinned: false,
  }
}

function createProject(id: string, userId: Id<"users">): Doc<"projects"> {
  return {
    _id: asId<"projects">(id),
    _creationTime: 1,
    userId,
    name: `Project ${id}`,
  }
}

function createCtx({
  identitySubject,
  users = [],
  chats = [],
  projects = [],
}: {
  identitySubject?: string
  users?: Doc<"users">[]
  chats?: Doc<"chats">[]
  projects?: Doc<"projects">[]
}) {
  const ctx = {
    auth: {
      getUserIdentity: async () =>
        identitySubject ? { subject: identitySubject } : null,
    },
    db: {
      get: async (id: string) =>
        chats.find((chat) => chat._id === id) ??
        projects.find((project) => project._id === id) ??
        null,
      query: (tableName: "users") => ({
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

          const results = users.filter((user) => {
            const record = user as unknown as Record<string, unknown>
            for (const [fieldName, value] of filters) {
              if (record[fieldName] !== value) return false
            }
            return true
          })

          return {
            unique: async () => {
              expect(tableName).toBe("users")
              expect(results.length).toBeLessThanOrEqual(1)
              return results[0] ?? null
            },
          }
        },
      }),
    },
  } as unknown as MutationCtx

  return ctx
}

describe("Convex auth helpers", () => {
  describe("current user lookup", () => {
    it.each([
      {
        name: "returns null without authentication",
        identitySubject: undefined,
        users: [],
        expected: null,
      },
      {
        name: "returns null when the authenticated subject has no user row",
        identitySubject: "workos_missing",
        users: [],
        expected: null,
      },
    ])("$name", async ({ identitySubject, users, expected }) => {
      const ctx = createCtx({ identitySubject, users })

      await expect(getCurrentUser(ctx)).resolves.toBe(expected)
    })

    it("returns the matching user for an authenticated subject", async () => {
      const user = createUser("user_1", "workos_user")
      const ctx = createCtx({
        identitySubject: user.workosUserId,
        users: [user],
      })

      await expect(getCurrentUser(ctx)).resolves.toEqual(user)
    })
  })

  describe("current user requirement", () => {
    it.each([
      {
        name: "rejects unauthenticated mutations",
        identitySubject: undefined,
        users: [],
        expectedError: "Not authenticated",
      },
      {
        name: "rejects create mutations when the authenticated user row is missing",
        identitySubject: "workos_missing",
        users: [],
        expectedError: "User not found",
      },
    ])("$name", async ({ identitySubject, users, expectedError }) => {
      const ctx = createCtx({ identitySubject, users })

      await expect(requireCurrentUser(ctx)).rejects.toThrow(expectedError)
    })
  })

  it.each([
    {
      name: "allows public chat reads without authentication",
      identitySubject: undefined,
      isPublic: true,
      users: (owner: Doc<"users">) => [owner],
      expected: "chat",
    },
    {
      name: "returns null for missing chat reads",
      identitySubject: undefined,
      isPublic: false,
      users: (owner: Doc<"users">) => [owner],
      omitChat: true,
      expected: null,
    },
    {
      name: "returns null for unauthenticated private chat reads",
      identitySubject: undefined,
      isPublic: false,
      users: (owner: Doc<"users">) => [owner],
      expected: null,
    },
    {
      name: "returns null for private chat reads when the authenticated user row is missing",
      identitySubject: "workos_owner",
      isPublic: false,
      users: () => [],
      expected: null,
    },
    {
      name: "returns null for wrong-owner private chat reads",
      identitySubject: "workos_other",
      isPublic: false,
      users: (owner: Doc<"users">, otherUser: Doc<"users">) => [
        owner,
        otherUser,
      ],
      expected: null,
    },
    {
      name: "allows owner private chat reads",
      identitySubject: "workos_owner",
      isPublic: false,
      users: (owner: Doc<"users">) => [owner],
      expected: "chat",
    },
  ])(
    "$name",
    async ({ identitySubject, isPublic, users, omitChat, expected }) => {
      const owner = createUser("user_1", "workos_owner")
      const otherUser = createUser("user_2", "workos_other")
      const chat = createChat("chat_1", owner._id, isPublic)
      const ctx = createCtx({
        identitySubject,
        users: users(owner, otherUser),
        chats: omitChat ? [] : [chat],
      })

      await expect(getAuthorizedChatForRead(ctx, chat._id)).resolves.toEqual(
        expected === "chat" ? chat : null
      )
    }
  )

  describe("owned chat requirement", () => {
    it.each([
      {
        name: "rejects missing chats",
        identitySubject: "workos_owner",
        users: (owner: Doc<"users">) => [owner],
        includeChat: false,
        expectedError: "Chat not found",
      },
      {
        name: "rejects unauthenticated chat mutations",
        identitySubject: undefined,
        users: (owner: Doc<"users">) => [owner],
        includeChat: true,
        expectedError: "Not authenticated",
      },
      {
        name: "rejects chat mutations when the authenticated user row is missing",
        identitySubject: "workos_owner",
        users: () => [],
        includeChat: true,
        expectedError: "Not authorized",
      },
      {
        name: "rejects wrong-owner chat mutations",
        identitySubject: "workos_other",
        users: (owner: Doc<"users">, otherUser: Doc<"users">) => [
          owner,
          otherUser,
        ],
        includeChat: true,
        expectedError: "Not authorized",
      },
    ])(
      "$name",
      async ({ identitySubject, users, includeChat, expectedError }) => {
        const owner = createUser("user_1", "workos_owner")
        const otherUser = createUser("user_2", "workos_other")
        const chat = createChat("chat_1", owner._id)
        const ctx = createCtx({
          identitySubject,
          users: users(owner, otherUser),
          chats: includeChat ? [chat] : [],
        })

        await expect(requireOwnedChat(ctx, chat._id)).rejects.toThrow(
          expectedError
        )
      }
    )

    it("returns the user and chat for owned chat mutations", async () => {
      const owner = createUser("user_1", "workos_owner")
      const chat = createChat("chat_1", owner._id)
      const ctx = createCtx({
        identitySubject: owner.workosUserId,
        users: [owner],
        chats: [chat],
      })

      await expect(requireOwnedChat(ctx, chat._id)).resolves.toEqual({
        user: owner,
        chat,
      })
    })
  })

  describe("owned project requirement", () => {
    it.each([
      {
        name: "rejects missing projects",
        identitySubject: "workos_owner",
        users: (owner: Doc<"users">) => [owner],
        includeProject: false,
        expectedError: "Project not found",
      },
      {
        name: "rejects unauthenticated project mutations",
        identitySubject: undefined,
        users: (owner: Doc<"users">) => [owner],
        includeProject: true,
        expectedError: "Not authenticated",
      },
      {
        name: "rejects project mutations when the authenticated user row is missing",
        identitySubject: "workos_owner",
        users: () => [],
        includeProject: true,
        expectedError: "Not authorized",
      },
      {
        name: "rejects wrong-owner project mutations",
        identitySubject: "workos_other",
        users: (owner: Doc<"users">, otherUser: Doc<"users">) => [
          owner,
          otherUser,
        ],
        includeProject: true,
        expectedError: "Not authorized",
      },
    ])(
      "$name",
      async ({ identitySubject, users, includeProject, expectedError }) => {
        const owner = createUser("user_1", "workos_owner")
        const otherUser = createUser("user_2", "workos_other")
        const project = createProject("project_1", owner._id)
        const ctx = createCtx({
          identitySubject,
          users: users(owner, otherUser),
          projects: includeProject ? [project] : [],
        })

        await expect(requireOwnedProject(ctx, project._id)).rejects.toThrow(
          expectedError
        )
      }
    )

    it("returns the user and project for owned project mutations", async () => {
      const owner = createUser("user_1", "workos_owner")
      const project = createProject("project_1", owner._id)
      const ctx = createCtx({
        identitySubject: owner.workosUserId,
        users: [owner],
        projects: [project],
      })

      await expect(requireOwnedProject(ctx, project._id)).resolves.toEqual({
        user: owner,
        project,
      })
    })
  })
})
