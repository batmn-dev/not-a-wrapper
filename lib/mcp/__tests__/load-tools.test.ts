import * as dns from "node:dns/promises"
import { decryptSecret } from "@/lib/encryption"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { recordFailure, resetAllCircuits } from "../circuit-breaker"
import { describeMcpConnectionError, loadUserMcpTools } from "../load-tools"

const mockCreateMCPClient = vi.fn()
const mockFetchQuery = vi.fn()
const mockFetchMutation = vi.fn()
const { mockResolve4, mockResolve6, mockTrustedRetryAllowlist } = vi.hoisted(
  () => ({
    mockResolve4: vi.fn(),
    mockResolve6: vi.fn(),
    mockTrustedRetryAllowlist: [] as string[],
  })
)

vi.mock("node:dns/promises", () => ({
  resolve4: mockResolve4,
  resolve6: mockResolve6,
}))

vi.mock("@ai-sdk/mcp", () => ({
  createMCPClient: (...args: unknown[]) => mockCreateMCPClient(...args),
}))

vi.mock("convex/nextjs", () => ({
  fetchQuery: (...args: unknown[]) => mockFetchQuery(...args),
  fetchMutation: (...args: unknown[]) => mockFetchMutation(...args),
}))

vi.mock("@/convex/_generated/api", () => ({
  api: {
    mcpServers: {
      list: "mcpServers:list",
      updateConnectionStatus: "mcpServers:updateConnectionStatus",
    },
    mcpToolApprovals: {
      listByUser: "mcpToolApprovals:listByUser",
    },
    users: {
      getCurrent: "users:getCurrent",
    },
  },
}))

vi.mock("@/lib/encryption", () => ({
  decryptSecret: vi.fn((encrypted: string) => `decrypted_${encrypted}`),
}))

vi.mock("node:dns/promises")

vi.mock("@/lib/config", () => ({
  MCP_CONNECTION_TIMEOUT_MS: 5000,
  MCP_MAX_TOOLS_PER_REQUEST: 50,
  MCP_CIRCUIT_BREAKER_THRESHOLD: 3,
  MCP_TRUSTED_RETRY_SERVER_ALLOWLIST: mockTrustedRetryAllowlist,
}))

function mockServer(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: "server_1",
    _creationTime: 1000,
    userId: "user_1",
    name: "Test Server",
    url: "https://mcp.example.com",
    transport: "http" as const,
    enabled: true,
    createdAt: 1000,
    ...overrides,
  }
}

function mockClient(tools: Record<string, unknown> = {}, closeError?: Error) {
  return {
    tools: vi.fn().mockResolvedValue(tools),
    close: closeError
      ? vi.fn().mockRejectedValue(closeError)
      : vi.fn().mockResolvedValue(undefined),
  }
}

/** Create MCP clients by URL, not call order, because DNS validation is parallel. */
function mockClientsByUrl(clients: Record<string, unknown>) {
  mockCreateMCPClient.mockImplementation(
    (options: { transport?: { url?: string } }) => {
      const url = options.transport?.url
      if (!url || !(url in clients)) {
        throw new Error(`Unexpected MCP client URL: ${url ?? "<missing>"}`)
      }
      return Promise.resolve(clients[url])
    }
  )
}

function mockTool(name: string) {
  return {
    description: `Tool: ${name}`,
    parameters: {},
    execute: vi.fn(),
  }
}

describe("describeMcpConnectionError", () => {
  it("rewrites redirect rejections into an actionable message", () => {
    // Node/undici shape: TypeError("fetch failed") with a redirect cause.
    const nodeShape = new TypeError("fetch failed")
    nodeShape.cause = new Error("unexpected redirect")
    // Bun shape: single error, redirect named in the message.
    const bunShape = new Error(
      'UnexpectedRedirect fetching "http://example.com/mcp"'
    )

    for (const reason of [nodeShape, bunShape]) {
      expect(describeMcpConnectionError(reason)).toContain(
        "responded with a redirect"
      )
    }
  })

  it("passes other errors through verbatim", () => {
    expect(
      describeMcpConnectionError(new Error("MCP connection timeout"))
    ).toBe("MCP connection timeout")
    expect(describeMcpConnectionError("not-an-error")).toBe("Connection failed")
  })
})

describe("loadUserMcpTools", () => {
  const mockResolve4 = vi.mocked(dns.resolve4)
  const mockResolve6 = vi.mocked(dns.resolve6)

  beforeEach(() => {
    vi.clearAllMocks()
    resetAllCircuits()
    mockTrustedRetryAllowlist.length = 0
    mockResolve4.mockResolvedValue(["93.184.216.34"])
    mockResolve6.mockRejectedValue(new Error("ENOTFOUND"))
    // fetchMutation is fire-and-forget with .catch() — must return a promise
    mockFetchMutation.mockResolvedValue(undefined)
    // Queued server/approval reads fall through to the owner read needed for
    // credential decryption.
    mockFetchQuery.mockImplementation((ref: unknown) =>
      Promise.resolve(
        ref === "users:getCurrent" ? { workosUserId: "test-user" } : []
      )
    )
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  describe("empty results", () => {
    it("returns empty result when no servers exist", async () => {
      mockFetchQuery
        .mockResolvedValueOnce([]) // mcpServers.list
        .mockResolvedValueOnce([]) // mcpToolApprovals.listByUser

      const result = await loadUserMcpTools("test-token")

      expect(result.tools).toEqual({})
      expect(result.clients).toEqual([])
      expect(result.toolServerMap.size).toBe(0)
    })

    it("returns empty result when all servers are disabled", async () => {
      mockFetchQuery
        .mockResolvedValueOnce([mockServer({ enabled: false })])
        .mockResolvedValueOnce([])

      const result = await loadUserMcpTools("test-token")

      expect(result.tools).toEqual({})
      expect(result.clients).toEqual([])
    })
  })

  describe("single server", () => {
    it("loads and namespaces tools from a single server", async () => {
      const server = mockServer({ name: "GitHub" })
      const client = mockClient({
        create_issue: mockTool("create_issue"),
        list_repos: mockTool("list_repos"),
      })

      mockFetchQuery.mockResolvedValueOnce([server]).mockResolvedValueOnce([]) // no specific approvals → default approved

      mockCreateMCPClient.mockResolvedValue(client)

      const result = await loadUserMcpTools("test-token")

      expect(result.tools).toHaveProperty("github_create_issue")
      expect(result.tools).toHaveProperty("github_list_repos")
      expect(result.clients).toHaveLength(1)
      await result.clients[0].close()
      expect(client.close).toHaveBeenCalledTimes(1)
      expect(mockCreateMCPClient).toHaveBeenCalledWith(
        expect.objectContaining({
          transport: expect.objectContaining({
            fetch: expect.any(Function),
            url: "https://mcp.example.com",
          }),
        })
      )

      const issueInfo = result.toolServerMap.get("github_create_issue")
      expect(issueInfo).toMatchObject({
        displayName: "create_issue",
        serverName: "GitHub",
        serverId: "server_1",
      })
    })

    it("maps MCP annotation hints when present", async () => {
      const server = mockServer({ name: "GitHub" })
      const client = mockClient({
        create_issue: {
          ...mockTool("create_issue"),
          annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: true,
          },
        },
      })

      mockFetchQuery.mockResolvedValueOnce([server]).mockResolvedValueOnce([])

      mockCreateMCPClient.mockResolvedValue(client)

      const result = await loadUserMcpTools("test-token")
      const issueInfo = result.toolServerMap.get("github_create_issue")

      expect(issueInfo).toMatchObject({
        displayName: "create_issue",
        serverName: "GitHub",
        serverId: "server_1",
        readOnly: false,
        destructive: true,
        idempotent: false,
        openWorld: true,
        retrySafetyTrusted: false,
        policyHintsTrusted: false,
      })
    })

    it("keeps annotation fields undefined when hints are missing", async () => {
      const server = mockServer({ name: "GitHub" })
      const client = mockClient({
        create_issue: {
          ...mockTool("create_issue"),
          annotations: {
            readOnlyHint: true,
            destructiveHint: "not-a-boolean",
            idempotentHint: 1,
          },
        },
      })

      mockFetchQuery.mockResolvedValueOnce([server]).mockResolvedValueOnce([])

      mockCreateMCPClient.mockResolvedValue(client)

      const result = await loadUserMcpTools("test-token")
      const issueInfo = result.toolServerMap.get("github_create_issue")

      expect(issueInfo).toBeDefined()
      expect(issueInfo?.readOnly).toBe(true)
      expect(issueInfo?.destructive).toBeUndefined()
      expect(issueInfo?.idempotent).toBeUndefined()
      expect(issueInfo?.openWorld).toBeUndefined()
      expect(issueInfo?.retrySafetyTrusted).toBe(false)
      expect(issueInfo?.policyHintsTrusted).toBe(false)
    })

    it("marks retry hints trusted when server matches allowlist", async () => {
      mockTrustedRetryAllowlist.push("github")

      const server = mockServer({ name: "GitHub" })
      const client = mockClient({
        create_issue: {
          ...mockTool("create_issue"),
          annotations: { idempotentHint: true },
        },
      })

      mockFetchQuery.mockResolvedValueOnce([server]).mockResolvedValueOnce([])

      mockCreateMCPClient.mockResolvedValue(client)

      const result = await loadUserMcpTools("test-token")
      const issueInfo = result.toolServerMap.get("github_create_issue")

      expect(issueInfo?.retrySafetyTrusted).toBe(true)
      expect(issueInfo?.policyHintsTrusted).toBe(true)
    })
  })

  describe("auth headers", () => {
    it("passes decrypted bearer auth headers to the MCP transport", async () => {
      const server = mockServer({
        name: "Authenticated",
        authType: "bearer",
        encryptedAuthValue: "encrypted-token",
        authIv: "iv-1",
      })
      const client = mockClient({
        protected_tool: mockTool("protected_tool"),
      })

      mockFetchQuery.mockResolvedValueOnce([server]).mockResolvedValueOnce([])

      mockCreateMCPClient.mockResolvedValue(client)

      const result = await loadUserMcpTools("test-token")

      expect(result.tools).toHaveProperty("authenticated_protected_tool")
      expect(decryptSecret).toHaveBeenCalledWith("encrypted-token", "iv-1", {
        kind: "mcpAuth",
        ownerId: "test-user",
      })
      expect(mockCreateMCPClient).toHaveBeenCalledWith({
        initializationOptions: { signal: expect.any(AbortSignal) },
        transport: {
          type: "http",
          url: "https://mcp.example.com",
          headers: { Authorization: "Bearer decrypted_encrypted-token" },
          fetch: expect.any(Function),
        },
      })
    })

    it("fails closed for auth-required servers when owner identity is unavailable", async () => {
      const server = mockServer({
        authType: "bearer",
        encryptedAuthValue: "encrypted-token",
        authIv: "iv-1",
      })

      mockFetchQuery.mockImplementation((ref: unknown) => {
        if (ref === "mcpServers:list") return Promise.resolve([server])
        if (ref === "mcpToolApprovals:listByUser") return Promise.resolve([])
        if (ref === "users:getCurrent") return Promise.resolve(null)
        return Promise.resolve([])
      })

      const result = await loadUserMcpTools("test-token")

      expect(mockCreateMCPClient).not.toHaveBeenCalled()
      expect(result.tools).toEqual({})
      expect(result.clients).toHaveLength(0)
      expect(result.failedServerCount).toBe(1)
      expect(mockFetchMutation).toHaveBeenCalledWith(
        "mcpServers:updateConnectionStatus",
        {
          serverId: "server_1",
          lastError: "Cannot load MCP auth headers: missing owner identity",
        },
        { token: "test-token" }
      )
    })

    it("fails closed for auth-required servers when auth decryption fails", async () => {
      const server = mockServer({
        authType: "bearer",
        encryptedAuthValue: "encrypted-token",
        authIv: "iv-1",
      })

      vi.mocked(decryptSecret).mockImplementationOnce(() => {
        throw new Error("bad auth tag")
      })
      mockFetchQuery.mockResolvedValueOnce([server]).mockResolvedValueOnce([])

      const result = await loadUserMcpTools("test-token")

      expect(mockCreateMCPClient).not.toHaveBeenCalled()
      expect(result.tools).toEqual({})
      expect(result.clients).toHaveLength(0)
      expect(result.failedServerCount).toBe(1)
      expect(mockFetchMutation).toHaveBeenCalledWith(
        "mcpServers:updateConnectionStatus",
        {
          serverId: "server_1",
          lastError: "Failed to decrypt MCP auth headers",
        },
        { token: "test-token" }
      )
    })
  })

  describe("multi-server merging", () => {
    it("merges tools from multiple servers with different namespaces", async () => {
      const servers = [
        mockServer({ _id: "s1", name: "GitHub" }),
        mockServer({
          _id: "s2",
          name: "Jira",
          url: "https://jira.example.com",
        }),
      ]

      const client1 = mockClient({
        create_issue: mockTool("create_issue"),
      })
      const client2 = mockClient({
        create_ticket: mockTool("create_ticket"),
      })

      mockFetchQuery.mockResolvedValueOnce(servers).mockResolvedValueOnce([])

      mockClientsByUrl({
        "https://mcp.example.com": client1,
        "https://jira.example.com": client2,
      })

      const result = await loadUserMcpTools("test-token")

      expect(result.tools).toHaveProperty("github_create_issue")
      expect(result.tools).toHaveProperty("jira_create_ticket")
      expect(result.clients).toHaveLength(2)
    })

    it("handles same tool name from different servers via namespacing", async () => {
      const servers = [
        mockServer({ _id: "s1", name: "Server A" }),
        mockServer({
          _id: "s2",
          name: "Server B",
          url: "https://b.example.com",
        }),
      ]

      const client1 = mockClient({ search: mockTool("search") })
      const client2 = mockClient({ search: mockTool("search") })

      mockFetchQuery.mockResolvedValueOnce(servers).mockResolvedValueOnce([])

      mockClientsByUrl({
        "https://mcp.example.com": client1,
        "https://b.example.com": client2,
      })

      const result = await loadUserMcpTools("test-token")

      expect(result.tools).toHaveProperty("server_a_search")
      expect(result.tools).toHaveProperty("server_b_search")
    })

    it("drops colliding namespaced tools when slug normalization collides", async () => {
      const servers = [
        mockServer({ _id: "s1", name: "Alpha Beta" }),
        mockServer({
          _id: "s2",
          name: "Alpha---Beta",
          url: "https://alpha2.example.com",
        }),
      ]

      const client1 = mockClient({ search: mockTool("search") })
      const client2 = mockClient({ search: mockTool("search") })

      mockFetchQuery.mockResolvedValueOnce(servers).mockResolvedValueOnce([])

      mockClientsByUrl({
        "https://mcp.example.com": client1,
        "https://alpha2.example.com": client2,
      })

      const result = await loadUserMcpTools("test-token")

      expect(result.tools).not.toHaveProperty("alpha_beta_search")
      expect(result.toolServerMap.has("alpha_beta_search")).toBe(false)
    })

    it("drops colliding namespaced tools when server slugs collide after truncation", async () => {
      const base = "a".repeat(30)
      const servers = [
        mockServer({ _id: "s1", name: `${base}-x` }),
        mockServer({
          _id: "s2",
          name: `${base}_y`,
          url: "https://long2.example.com",
        }),
      ]

      const client1 = mockClient({ lookup: mockTool("lookup") })
      const client2 = mockClient({ lookup: mockTool("lookup") })

      mockFetchQuery.mockResolvedValueOnce(servers).mockResolvedValueOnce([])

      mockClientsByUrl({
        "https://mcp.example.com": client1,
        "https://long2.example.com": client2,
      })

      const result = await loadUserMcpTools("test-token")
      const collidingName = `${base}_lookup`

      expect(result.tools).not.toHaveProperty(collidingName)
      expect(result.toolServerMap.has(collidingName)).toBe(false)
    })
  })

  describe("approval filtering", () => {
    it("excludes tools that are explicitly not approved", async () => {
      const server = mockServer({ _id: "s1", name: "GitHub" })
      const client = mockClient({
        approved_tool: mockTool("approved_tool"),
        rejected_tool: mockTool("rejected_tool"),
      })

      mockFetchQuery.mockResolvedValueOnce([server]).mockResolvedValueOnce([
        {
          _id: "a1",
          userId: "user_1",
          serverId: "s1",
          toolName: "approved_tool",
          approved: true,
        },
        {
          _id: "a2",
          userId: "user_1",
          serverId: "s1",
          toolName: "rejected_tool",
          approved: false,
        },
      ])

      mockCreateMCPClient.mockResolvedValue(client)

      const result = await loadUserMcpTools("test-token")

      expect(result.tools).toHaveProperty("github_approved_tool")
      expect(result.tools).not.toHaveProperty("github_rejected_tool")
    })

    it("defaults to approved when no approval record exists (v1 trust model)", async () => {
      const server = mockServer({ _id: "s1", name: "GitHub" })
      const client = mockClient({
        new_tool: mockTool("new_tool"),
      })

      mockFetchQuery.mockResolvedValueOnce([server]).mockResolvedValueOnce([]) // no approval records at all

      mockCreateMCPClient.mockResolvedValue(client)

      const result = await loadUserMcpTools("test-token")

      expect(result.tools).toHaveProperty("github_new_tool")
    })
  })

  describe("tool limit", () => {
    it("stops adding tools after reaching MCP_MAX_TOOLS_PER_REQUEST", async () => {
      const tools: Record<string, unknown> = {}
      for (let i = 0; i < 60; i++) {
        tools[`tool_${i}`] = mockTool(`tool_${i}`)
      }

      const server = mockServer({ name: "ManyTools" })
      const client = mockClient(tools)

      mockFetchQuery.mockResolvedValueOnce([server]).mockResolvedValueOnce([])

      mockCreateMCPClient.mockResolvedValue(client)

      const result = await loadUserMcpTools("test-token")

      expect(Object.keys(result.tools).length).toBeLessThanOrEqual(50)
    })
  })

  describe("error handling", () => {
    it("skips failed server connections gracefully", async () => {
      const servers = [
        mockServer({ _id: "s1", name: "Healthy" }),
        mockServer({
          _id: "s2",
          name: "Broken",
          url: "https://broken.example.com",
        }),
      ]

      const healthyClient = mockClient({
        working_tool: mockTool("working_tool"),
      })

      mockFetchQuery.mockResolvedValueOnce(servers).mockResolvedValueOnce([])

      mockCreateMCPClient.mockImplementation(
        (options: { transport?: { url?: string } }) => {
          if (options.transport?.url === "https://broken.example.com") {
            return Promise.reject(new Error("Connection refused"))
          }
          return Promise.resolve(healthyClient)
        }
      )

      const result = await loadUserMcpTools("test-token")

      expect(result.tools).toHaveProperty("healthy_working_tool")
      expect(result.clients).toHaveLength(1)
    })

    it("returns empty tools when ALL servers fail", async () => {
      const server = mockServer({ _id: "s1", name: "Broken" })

      mockFetchQuery.mockResolvedValueOnce([server]).mockResolvedValueOnce([])

      mockCreateMCPClient.mockRejectedValue(new Error("Timeout"))

      const result = await loadUserMcpTools("test-token")

      expect(result.tools).toEqual({})
      expect(result.clients).toHaveLength(0)
    })

    it("handles tools() call failure after successful connection", async () => {
      const servers = [
        mockServer({ _id: "s1", name: "Flaky" }),
        mockServer({
          _id: "s2",
          name: "Stable",
          url: "https://stable.example.com",
        }),
      ]

      const flakyClient = {
        tools: vi.fn().mockRejectedValue(new Error("Tool enumeration failed")),
        close: vi.fn().mockResolvedValue(undefined),
      }
      const stableClient = mockClient({
        good_tool: mockTool("good_tool"),
      })

      mockFetchQuery.mockResolvedValueOnce(servers).mockResolvedValueOnce([])

      mockClientsByUrl({
        "https://mcp.example.com": flakyClient,
        "https://stable.example.com": stableClient,
      })

      const result = await loadUserMcpTools("test-token")

      expect(result.tools).toHaveProperty("stable_good_tool")
      expect(result.clients).toHaveLength(1)
      expect(result.failedServerCount).toBe(1)
      expect(flakyClient.close).toHaveBeenCalledTimes(1)
    })
  })

  describe("circuit breaker", () => {
    it("skips servers with open circuits", async () => {
      const servers = [
        mockServer({ _id: "s1", name: "Healthy" }),
        mockServer({
          _id: "s2",
          name: "CircuitOpen",
          url: "https://bad.example.com",
        }),
      ]

      recordFailure("s2")
      recordFailure("s2")
      recordFailure("s2")

      const healthyClient = mockClient({
        tool: mockTool("tool"),
      })

      mockFetchQuery.mockResolvedValueOnce(servers).mockResolvedValueOnce([])

      mockCreateMCPClient.mockResolvedValue(healthyClient)

      const result = await loadUserMcpTools("test-token")

      expect(mockCreateMCPClient).toHaveBeenCalledTimes(1)
      expect(result.tools).toHaveProperty("healthy_tool")
    })

    it("returns empty when all servers have open circuits", async () => {
      const servers = [
        mockServer({ _id: "s1", name: "Bad1" }),
        mockServer({
          _id: "s2",
          name: "Bad2",
          url: "https://bad2.example.com",
        }),
      ]

      for (let i = 0; i < 3; i++) {
        recordFailure("s1")
        recordFailure("s2")
      }

      mockFetchQuery.mockResolvedValueOnce(servers).mockResolvedValueOnce([])

      const result = await loadUserMcpTools("test-token")

      expect(mockCreateMCPClient).not.toHaveBeenCalled()
      expect(result.tools).toEqual({})
    })
  })

  describe("timeout orphan cleanup", () => {
    it("discovers servers in parallel and keeps healthy tools when others time out", async () => {
      vi.useFakeTimers()
      try {
        const slow = mockClient()
        slow.tools.mockReturnValue(new Promise(() => {}))
        const healthy = mockClient({ tool: mockTool("tool") })
        mockFetchQuery
          .mockResolvedValueOnce([
            mockServer({ _id: "slow", name: "Slow" }),
            mockServer({
              _id: "healthy",
              name: "Healthy",
              url: "https://healthy.example.com",
            }),
          ])
          .mockResolvedValueOnce([])
        mockClientsByUrl({
          "https://mcp.example.com": slow,
          "https://healthy.example.com": healthy,
        })
        const pending = loadUserMcpTools("test-token", { timeout: 50 })
        await vi.advanceTimersByTimeAsync(0)
        expect(slow.tools).toHaveBeenCalledTimes(1)
        expect(healthy.tools).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(50)
        const result = await pending
        expect(result.tools).toHaveProperty("healthy_tool")
        expect(result.failedServerCount).toBe(1)
        expect(result.clients).toHaveLength(1)
        expect(slow.close).toHaveBeenCalledTimes(1)
        expect(healthy.close).not.toHaveBeenCalled()
        await result.clients[0].close()
      } finally {
        vi.useRealTimers()
      }
    })

    it("closes orphaned client when timeout wins the race", async () => {
      const server = mockServer({ name: "Slow" })
      const orphanedClient = mockClient({ tool: mockTool("tool") })

      mockFetchQuery.mockResolvedValueOnce([server]).mockResolvedValueOnce([])

      // The client resolves only after the load timeout.
      let resolveClient!: (value: typeof orphanedClient) => void
      mockCreateMCPClient.mockReturnValue(
        new Promise((resolve) => {
          resolveClient = resolve
        })
      )

      const result = await loadUserMcpTools("test-token", { timeout: 10 })

      expect(result.clients).toHaveLength(0)
      expect(result.failedServerCount).toBe(1)

      // Late resolution must close the orphaned connection.
      resolveClient(orphanedClient)
      await Promise.resolve()

      expect(orphanedClient.close).toHaveBeenCalledTimes(1)
    })

    it("does not crash when orphaned client also rejects", async () => {
      const server = mockServer({ name: "Broken" })

      mockFetchQuery.mockResolvedValueOnce([server]).mockResolvedValueOnce([])

      let rejectClient!: (reason: Error) => void
      mockCreateMCPClient.mockReturnValue(
        new Promise((_, reject) => {
          rejectClient = reject
        })
      )

      const result = await loadUserMcpTools("test-token", { timeout: 10 })

      expect(result.clients).toHaveLength(0)
      expect(result.failedServerCount).toBe(1)

      // A post-timeout rejection must be absorbed.
      rejectClient(new Error("Connection also failed"))
      await Promise.resolve()
    })
  })
})
