import { beforeEach, describe, expect, it, vi } from "vitest"
import { recordFailure, resetAllCircuits } from "../circuit-breaker"
// =============================================================================
// Import after mocks
// =============================================================================

import {
  describeMcpConnectionError,
  loadUserMcpTools,
  slugify,
} from "../load-tools"

// =============================================================================
// Module mocks — must be before imports that use them
// =============================================================================

const mockCreateMCPClient = vi.fn()
const mockFetchQuery = vi.fn()
const mockFetchMutation = vi.fn()
const { mockTrustedRetryAllowlist } = vi.hoisted(() => ({
  mockTrustedRetryAllowlist: [] as string[],
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
  },
}))

vi.mock("@/lib/encryption", () => ({
  decryptKey: vi.fn((encrypted: string) => `decrypted_${encrypted}`),
}))

vi.mock("@/lib/config", () => ({
  MCP_CONNECTION_TIMEOUT_MS: 5000,
  MCP_MAX_TOOLS_PER_REQUEST: 50,
  MCP_CIRCUIT_BREAKER_THRESHOLD: 3,
  MCP_TRUSTED_RETRY_SERVER_ALLOWLIST: mockTrustedRetryAllowlist,
}))

// =============================================================================
// Test Helpers
// =============================================================================

/** Create a mock MCP server config (matches Convex document shape) */
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

/** Create a mock MCP client with tools */
function mockClient(tools: Record<string, unknown> = {}, closeError?: Error) {
  return {
    tools: vi.fn().mockResolvedValue(tools),
    close: closeError
      ? vi.fn().mockRejectedValue(closeError)
      : vi.fn().mockResolvedValue(undefined),
  }
}

/** Create a mock tool object */
function mockTool(name: string) {
  return {
    description: `Tool: ${name}`,
    parameters: {},
    execute: vi.fn(),
  }
}

// =============================================================================
// Tests
// =============================================================================

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

describe("slugify", () => {
  it("converts name to lowercase URL-safe slug", () => {
    expect(slugify("My GitHub Server")).toBe("my_github_server")
  })

  it("replaces special characters with underscores", () => {
    expect(slugify("Server (v2.0)")).toBe("server_v2_0")
  })

  it("strips leading and trailing underscores", () => {
    expect(slugify("--My Server--")).toBe("my_server")
  })

  it("truncates to 30 characters", () => {
    const longName = "a".repeat(50)
    expect(slugify(longName).length).toBeLessThanOrEqual(30)
  })

  it("returns 'server' for empty-ish names", () => {
    expect(slugify("")).toBe("server")
    expect(slugify("---")).toBe("server")
    expect(slugify("!!!")).toBe("server")
  })

  it("collapses consecutive special chars into single underscore", () => {
    expect(slugify("hello---world")).toBe("hello_world")
  })
})

describe("loadUserMcpTools", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAllCircuits()
    mockTrustedRetryAllowlist.length = 0
    // fetchMutation is fire-and-forget with .catch() — must return a promise
    mockFetchMutation.mockResolvedValue(undefined)
    // Suppress console output in tests
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  // ===========================================================================
  // Empty / no servers
  // ===========================================================================

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

  // ===========================================================================
  // Single server tool loading
  // ===========================================================================

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

      // Tools should be namespaced: github_create_issue, github_list_repos
      expect(result.tools).toHaveProperty("github_create_issue")
      expect(result.tools).toHaveProperty("github_list_repos")
      expect(result.clients).toHaveLength(1)
      expect(result.clients[0]).toBe(client)

      // Tool server map should have entries
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

  // ===========================================================================
  // Multi-server tool merging
  // ===========================================================================

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

      mockCreateMCPClient
        .mockResolvedValueOnce(client1)
        .mockResolvedValueOnce(client2)

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

      mockCreateMCPClient
        .mockResolvedValueOnce(client1)
        .mockResolvedValueOnce(client2)

      const result = await loadUserMcpTools("test-token")

      // Both should exist under different namespaces
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

      mockCreateMCPClient
        .mockResolvedValueOnce(client1)
        .mockResolvedValueOnce(client2)

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

      mockCreateMCPClient
        .mockResolvedValueOnce(client1)
        .mockResolvedValueOnce(client2)

      const result = await loadUserMcpTools("test-token")
      const collidingName = `${base}_lookup`

      expect(result.tools).not.toHaveProperty(collidingName)
      expect(result.toolServerMap.has(collidingName)).toBe(false)
    })
  })

  // ===========================================================================
  // Approval filtering
  // ===========================================================================

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

      // Tool should be included by default
      expect(result.tools).toHaveProperty("github_new_tool")
    })
  })

  // ===========================================================================
  // Tool limit enforcement
  // ===========================================================================

  describe("tool limit", () => {
    it("stops adding tools after reaching MCP_MAX_TOOLS_PER_REQUEST", async () => {
      // Create a server with many tools
      const tools: Record<string, unknown> = {}
      for (let i = 0; i < 60; i++) {
        tools[`tool_${i}`] = mockTool(`tool_${i}`)
      }

      const server = mockServer({ name: "ManyTools" })
      const client = mockClient(tools)

      mockFetchQuery.mockResolvedValueOnce([server]).mockResolvedValueOnce([])

      mockCreateMCPClient.mockResolvedValue(client)

      const result = await loadUserMcpTools("test-token")

      // Should cap at MCP_MAX_TOOLS_PER_REQUEST (50)
      expect(Object.keys(result.tools).length).toBeLessThanOrEqual(50)
    })
  })

  // ===========================================================================
  // Error handling / graceful degradation
  // ===========================================================================

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

      // Should have tools from the healthy server only
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

      mockCreateMCPClient
        .mockResolvedValueOnce(flakyClient)
        .mockResolvedValueOnce(stableClient)

      const result = await loadUserMcpTools("test-token")

      // Should have tools from stable server, flaky server's tools() failed
      expect(result.tools).toHaveProperty("stable_good_tool")
      // Both clients are in the list (connection succeeded for both)
      expect(result.clients).toHaveLength(2)
    })
  })

  // ===========================================================================
  // Circuit breaker integration
  // ===========================================================================

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

      // Open circuit for s2 (3 consecutive failures)
      recordFailure("s2")
      recordFailure("s2")
      recordFailure("s2")

      const healthyClient = mockClient({
        tool: mockTool("tool"),
      })

      mockFetchQuery.mockResolvedValueOnce(servers).mockResolvedValueOnce([])

      mockCreateMCPClient.mockResolvedValue(healthyClient)

      const result = await loadUserMcpTools("test-token")

      // Only one client should be created (s2 skipped)
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

      // Open circuits for both
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

  // ===========================================================================
  // Timeout orphan cleanup (resource leak prevention)
  // ===========================================================================

  describe("timeout orphan cleanup", () => {
    it("closes orphaned client when timeout wins the race", async () => {
      const server = mockServer({ name: "Slow" })
      const orphanedClient = mockClient({ tool: mockTool("tool") })

      mockFetchQuery.mockResolvedValueOnce([server]).mockResolvedValueOnce([])

      // Use a deferred promise so the client never resolves during loadUserMcpTools
      let resolveClient!: (value: typeof orphanedClient) => void
      mockCreateMCPClient.mockReturnValue(
        new Promise((resolve) => {
          resolveClient = resolve
        })
      )

      const result = await loadUserMcpTools("test-token", { timeout: 10 })

      // Timeout should have won — no clients in the result
      expect(result.clients).toHaveLength(0)
      expect(result.failedServerCount).toBe(1)

      // Now resolve the orphaned client — simulates a slow server eventually connecting
      resolveClient(orphanedClient)
      // Flush microtasks so the .then() cleanup handler runs
      await new Promise((resolve) => setTimeout(resolve, 0))

      // The orphaned client should have been closed
      expect(orphanedClient.close).toHaveBeenCalledTimes(1)
    })

    it("does not crash when orphaned client also rejects", async () => {
      const server = mockServer({ name: "Broken" })

      mockFetchQuery.mockResolvedValueOnce([server]).mockResolvedValueOnce([])

      // Client promise will also reject (after the timeout)
      let rejectClient!: (reason: Error) => void
      mockCreateMCPClient.mockReturnValue(
        new Promise((_, reject) => {
          rejectClient = reject
        })
      )

      const result = await loadUserMcpTools("test-token", { timeout: 10 })

      expect(result.clients).toHaveLength(0)
      expect(result.failedServerCount).toBe(1)

      // Client also fails — the empty rejection handler should absorb it
      rejectClient(new Error("Connection also failed"))
      await new Promise((resolve) => setTimeout(resolve, 0))

      // No unhandled rejection — test passes if it reaches here
    })
  })

  // ===========================================================================
  // Options
  // ===========================================================================

  describe("options", () => {
    it("uses custom timeout when provided", async () => {
      const server = mockServer({ name: "Slow" })
      const client = mockClient({ tool: mockTool("tool") })

      mockFetchQuery.mockResolvedValueOnce([server]).mockResolvedValueOnce([])

      mockCreateMCPClient.mockResolvedValue(client)

      await loadUserMcpTools("test-token", { timeout: 1000 })

      // The function should still work — we're just verifying it accepts the option
      expect(mockCreateMCPClient).toHaveBeenCalled()
    })
  })
})
