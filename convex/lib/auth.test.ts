import { describe, expect, it } from "vitest"
import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"
import {
  filterActiveChats,
  getAuthorizedChatForRead,
  getCurrentUser,
  getReadableChatByPublicId,
  requireCurrentUser,
  requireOwnedChat,
  requireOwnedChatByPublicId,
  requireOwnedGenerationRun,
  requireOwnedMcpServer,
  requireOwnedProject,
} from "./auth"

type QueryBuilder = {
  eq: (fieldName: string, value: unknown) => QueryBuilder
}

function asId<
  Table extends
    | "users"
    | "chats"
    | "projects"
    | "mcpServers"
    | "generationRuns",
>(value: string): Id<Table> {
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
    publicId: `${id}-public`,
    userId,
    public: isPublic,
    pinned: false,
    updatedAt: 1,
  }
}

function createProject(id: string, userId: Id<"users">): Doc<"projects"> {
  return {
    _id: asId<"projects">(id),
    _creationTime: 1,
    userId,
    name: `Project ${id}`,
    updatedAt: 1,
    pinned: false,
  }
}

function createMcpServer(id: string, userId: Id<"users">): Doc<"mcpServers"> {
  return {
    _id: asId<"mcpServers">(id),
    _creationTime: 1,
    userId,
    name: `Server ${id}`,
    url: "https://example.com/mcp",
    transport: "http",
    enabled: true,
    createdAt: 1,
  }
}

function createGenerationRun(
  id: string,
  chatId: Id<"chats">,
  userId: Id<"users">
): Doc<"generationRuns"> {
  return {
    _id: asId<"generationRuns">(id),
    _creationTime: 1,
    chatId,
    userId,
    requestId: `request_${id}`,
    model: "gpt-5",
    provider: "openai",
    status: "running",
    updatedAt: 1,
  }
}

function createCtx({
  identitySubject,
  users = [],
  chats = [],
  projects = [],
  mcpServers = [],
  generationRuns = [],
  onDbGet,
}: {
  identitySubject?: string
  users?: Doc<"users">[]
  chats?: Doc<"chats">[]
  projects?: Doc<"projects">[]
  mcpServers?: Doc<"mcpServers">[]
  generationRuns?: Doc<"generationRuns">[]
  onDbGet?: (id: string) => void
}) {
  const ctx = {
    auth: {
      getUserIdentity: async () =>
        identitySubject ? { subject: identitySubject } : null,
    },
    db: {
      get: async (id: string) => {
        onDbGet?.(id)
        return (
          chats.find((chat) => chat._id === id) ??
          projects.find((project) => project._id === id) ??
          mcpServers.find((server) => server._id === id) ??
          generationRuns.find((run) => run._id === id) ??
          null
        )
      },
      query: (tableName: "users" | "chats") => ({
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

          const rows: Array<Doc<"users"> | Doc<"chats">> =
            tableName === "chats" ? chats : users
          const results = rows.filter((row) => {
            const record = row as unknown as Record<string, unknown>
            for (const [fieldName, value] of filters) {
              if (record[fieldName] !== value) return false
            }
            return true
          })

          return {
            unique: async () => {
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
  describe("Chat activity projection", () => {
    it("filters child and parent tombstones while de-duplicating project reads", async () => {
      const owner = createUser("user_1", "workos_owner")
      const activeProject = createProject("project_active", owner._id)
      const deletingProject = {
        ...createProject("project_deleting", owner._id),
        deletingAt: 2,
      }
      const personal = createChat("chat_personal", owner._id)
      const activeSiblings = [
        {
          ...createChat("chat_active_1", owner._id),
          projectId: activeProject._id,
        },
        {
          ...createChat("chat_active_2", owner._id),
          projectId: activeProject._id,
        },
      ]
      const projectDeleting = {
        ...createChat("chat_project_deleting", owner._id),
        projectId: deletingProject._id,
      }
      const rootDeleting = {
        ...createChat("chat_root_deleting", owner._id),
        deletingAt: 3,
      }
      const dangling = {
        ...createChat("chat_dangling", owner._id),
        projectId: asId<"projects">("project_missing"),
      }
      const reads: string[] = []
      const ctx = createCtx({
        projects: [activeProject, deletingProject],
        onDbGet: (id) => reads.push(id),
      })

      await expect(
        filterActiveChats(ctx, [
          personal,
          ...activeSiblings,
          projectDeleting,
          rootDeleting,
          dangling,
        ])
      ).resolves.toEqual([personal, ...activeSiblings])
      expect(reads).toEqual([
        activeProject._id,
        deletingProject._id,
        dangling.projectId,
      ])
    })
  })

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

  it("returns null for a tombstoned public chat just like a missing chat", async () => {
    const owner = createUser("user_1", "workos_owner")
    const chat = {
      ...createChat("chat_1", owner._id, true),
      deletingAt: 2,
    }
    const ctx = createCtx({ users: [owner], chats: [chat] })

    await expect(getAuthorizedChatForRead(ctx, chat._id)).resolves.toBeNull()
  })

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

    it("does not read the chat row before authenticating mutations", async () => {
      const owner = createUser("user_1", "workos_owner")
      const chat = createChat("chat_1", owner._id)
      const dbGetCalls: string[] = []
      const ctx = createCtx({
        identitySubject: undefined,
        users: [owner],
        chats: [chat],
        onDbGet: (id) => dbGetCalls.push(id),
      })

      await expect(requireOwnedChat(ctx, chat._id)).rejects.toThrow(
        "Not authenticated"
      )
      expect(dbGetCalls).toEqual([])
    })

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

    it("rejects a chat whose linked project is tombstoned as missing", async () => {
      const owner = createUser("user_1", "workos_owner")
      const project = {
        ...createProject("project_1", owner._id),
        deletingAt: 2,
      }
      const chat = {
        ...createChat("chat_1", owner._id),
        projectId: project._id,
      }
      const ctx = createCtx({
        identitySubject: owner.workosUserId,
        users: [owner],
        chats: [chat],
        projects: [project],
      })

      await expect(requireOwnedChat(ctx, chat._id)).rejects.toThrow(
        "Chat not found"
      )
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

    it("does not read the project row before authenticating mutations", async () => {
      const owner = createUser("user_1", "workos_owner")
      const project = createProject("project_1", owner._id)
      const dbGetCalls: string[] = []
      const ctx = createCtx({
        identitySubject: undefined,
        users: [owner],
        projects: [project],
        onDbGet: (id) => dbGetCalls.push(id),
      })

      await expect(requireOwnedProject(ctx, project._id)).rejects.toThrow(
        "Not authenticated"
      )
      expect(dbGetCalls).toEqual([])
    })

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

    it("rejects a tombstoned project as missing", async () => {
      const owner = createUser("user_1", "workos_owner")
      const project = {
        ...createProject("project_1", owner._id),
        deletingAt: 2,
      }
      const ctx = createCtx({
        identitySubject: owner.workosUserId,
        users: [owner],
        projects: [project],
      })

      await expect(requireOwnedProject(ctx, project._id)).rejects.toThrow(
        "Project not found"
      )
    })
  })

  describe("owned MCP server requirement", () => {
    it("rejects unauthenticated server mutations", async () => {
      const owner = createUser("user_1", "workos_owner")
      const server = createMcpServer("server_1", owner._id)
      const ctx = createCtx({ users: [owner], mcpServers: [server] })

      await expect(requireOwnedMcpServer(ctx, server._id)).rejects.toThrow(
        "Not authenticated"
      )
    })

    it("reports a missing server distinctly from an authorization failure", async () => {
      const owner = createUser("user_1", "workos_owner")
      const ctx = createCtx({
        identitySubject: owner.workosUserId,
        users: [owner],
        mcpServers: [],
      })

      await expect(
        requireOwnedMcpServer(ctx, asId<"mcpServers">("server_missing"))
      ).rejects.toThrow("MCP server not found")
    })

    it("rejects wrong-owner server mutations with Not authorized", async () => {
      const owner = createUser("user_1", "workos_owner")
      const otherUser = createUser("user_2", "workos_other")
      const server = createMcpServer("server_1", owner._id)
      const ctx = createCtx({
        identitySubject: otherUser.workosUserId,
        users: [owner, otherUser],
        mcpServers: [server],
      })

      await expect(requireOwnedMcpServer(ctx, server._id)).rejects.toThrow(
        "Not authorized"
      )
    })

    it("returns the user and server for an owned server", async () => {
      const owner = createUser("user_1", "workos_owner")
      const server = createMcpServer("server_1", owner._id)
      const ctx = createCtx({
        identitySubject: owner.workosUserId,
        users: [owner],
        mcpServers: [server],
      })

      await expect(requireOwnedMcpServer(ctx, server._id)).resolves.toEqual({
        user: owner,
        server,
      })
    })
  })

  describe("owned generation run requirement", () => {
    it.each([
      {
        name: "rejects missing runs for authenticated owners",
        identitySubject: "workos_owner",
        users: (owner: Doc<"users">) => [owner],
        includeRun: false,
        expectedError: "Run not found",
      },
      {
        name: "rejects unauthenticated run mutations",
        identitySubject: undefined,
        users: (owner: Doc<"users">) => [owner],
        includeRun: true,
        expectedError: "Not authenticated",
      },
      {
        name: "rejects run mutations when the authenticated user row is missing",
        identitySubject: "workos_owner",
        users: () => [],
        includeRun: true,
        expectedError: "Not authorized",
      },
      {
        name: "rejects wrong-owner run mutations as not found",
        identitySubject: "workos_other",
        users: (owner: Doc<"users">, otherUser: Doc<"users">) => [
          owner,
          otherUser,
        ],
        includeRun: true,
        expectedError: "Run not found",
      },
    ])(
      "$name",
      async ({ identitySubject, users, includeRun, expectedError }) => {
        const owner = createUser("user_1", "workos_owner")
        const otherUser = createUser("user_2", "workos_other")
        const chat = createChat("chat_1", owner._id)
        const run = createGenerationRun("run_1", chat._id, owner._id)
        const ctx = createCtx({
          identitySubject,
          users: users(owner, otherUser),
          chats: [chat],
          generationRuns: includeRun ? [run] : [],
        })

        await expect(requireOwnedGenerationRun(ctx, run._id)).rejects.toThrow(
          expectedError
        )
      }
    )

    it("does not read the run row before authenticating run mutations", async () => {
      const owner = createUser("user_1", "workos_owner")
      const chat = createChat("chat_1", owner._id)
      const run = createGenerationRun("run_1", chat._id, owner._id)
      const dbGetCalls: string[] = []
      const ctx = createCtx({
        identitySubject: undefined,
        users: [owner],
        chats: [chat],
        generationRuns: [run],
        onDbGet: (id) => dbGetCalls.push(id),
      })

      await expect(requireOwnedGenerationRun(ctx, run._id)).rejects.toThrow(
        "Not authenticated"
      )
      expect(dbGetCalls).toEqual([])
    })

    it("does not read the run row when the authenticated user row is missing", async () => {
      const owner = createUser("user_1", "workos_owner")
      const chat = createChat("chat_1", owner._id)
      const run = createGenerationRun("run_1", chat._id, owner._id)
      const dbGetCalls: string[] = []
      const ctx = createCtx({
        identitySubject: owner.workosUserId,
        users: [],
        chats: [chat],
        generationRuns: [run],
        onDbGet: (id) => dbGetCalls.push(id),
      })

      await expect(requireOwnedGenerationRun(ctx, run._id)).rejects.toThrow(
        "Not authorized"
      )
      expect(dbGetCalls).toEqual([])
    })

    it("rejects generation runs whose chat linkage is inconsistent", async () => {
      const owner = createUser("user_1", "workos_owner")
      const otherUser = createUser("user_2", "workos_other")
      const otherChat = createChat("chat_2", otherUser._id)
      const run = createGenerationRun("run_1", otherChat._id, owner._id)
      const ctx = createCtx({
        identitySubject: owner.workosUserId,
        users: [owner, otherUser],
        chats: [otherChat],
        generationRuns: [run],
      })

      await expect(requireOwnedGenerationRun(ctx, run._id)).rejects.toThrow(
        "Run not found"
      )
    })

    it("resolves ownership transitively through the run's chat", async () => {
      const owner = createUser("user_1", "workos_owner")
      const chat = createChat("chat_1", owner._id)
      const run = createGenerationRun("run_1", chat._id, owner._id)
      const ctx = createCtx({
        identitySubject: owner.workosUserId,
        users: [owner],
        chats: [chat],
        generationRuns: [run],
      })

      await expect(requireOwnedGenerationRun(ctx, run._id)).resolves.toEqual({
        user: owner,
        chat,
        run,
      })
    })

    it("rejects a run whose chat is tombstoned as missing", async () => {
      const owner = createUser("user_1", "workos_owner")
      const chat = {
        ...createChat("chat_1", owner._id),
        deletingAt: 2,
      }
      const run = createGenerationRun("run_1", chat._id, owner._id)
      const ctx = createCtx({
        identitySubject: owner.workosUserId,
        users: [owner],
        chats: [chat],
        generationRuns: [run],
      })

      await expect(requireOwnedGenerationRun(ctx, run._id)).rejects.toThrow(
        "Run not found"
      )
    })
  })
})

// The client-facing boundary (ADR-0031): a chat is named by its client-minted
// publicId and resolved to the owner-verified document exactly once.
describe("chat publicId boundary", () => {
  const owner = createUser("user_1", "workos_owner")
  const other = createUser("user_2", "workos_other")
  const chat = createChat("chat_1", owner._id)

  it("resolves the owner's chat by publicId", async () => {
    const ctx = createCtx({
      identitySubject: owner.workosUserId,
      users: [owner, other],
      chats: [chat],
    })

    await expect(
      requireOwnedChatByPublicId(ctx, chat.publicId)
    ).resolves.toEqual({ user: owner, chat })
    await expect(getReadableChatByPublicId(ctx, chat.publicId)).resolves.toBe(
      chat
    )
  })

  it("rejects a non-owner and hides the private chat from their reads", async () => {
    const ctx = createCtx({
      identitySubject: other.workosUserId,
      users: [owner, other],
      chats: [chat],
    })

    await expect(
      requireOwnedChatByPublicId(ctx, chat.publicId)
    ).rejects.toThrow("Not authorized")
    await expect(
      getReadableChatByPublicId(ctx, chat.publicId)
    ).resolves.toBeNull()
  })

  it("treats an unknown publicId as not found", async () => {
    const ctx = createCtx({
      identitySubject: owner.workosUserId,
      users: [owner],
      chats: [chat],
    })

    await expect(
      requireOwnedChatByPublicId(ctx, "made-up-public")
    ).rejects.toThrow("Chat not found")
    await expect(
      getReadableChatByPublicId(ctx, "made-up-public")
    ).resolves.toBeNull()
  })
})
