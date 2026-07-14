import { loadMCPToolsFromURL } from "@/lib/mcp/load-mcp-from-url"
import { McpUrlValidationError } from "@/lib/mcp/url-validation"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { POST } from "./route"

const routeMocks = vi.hoisted(() => ({
  buildStoredMcpAuthHeaders: vi.fn(),
  query: vi.fn(),
}))

vi.mock("@/app/api/_lib/authenticated-route", () => ({
  authenticatedRoute:
    (handler: (req: Request, ctx: unknown) => Promise<Response> | Response) =>
    (req: Request) =>
      handler(req, {
        session: { userId: "user-1" },
        convex: { query: routeMocks.query },
      }),
}))

vi.mock("@/lib/mcp/auth-headers", () => ({
  buildStoredMcpAuthHeaders: routeMocks.buildStoredMcpAuthHeaders,
}))

vi.mock("@/lib/config", () => ({
  MCP_CONNECTION_TIMEOUT_MS: 5_000,
  MCP_TEST_RATE_LIMIT: { limit: 10, windowMs: 60_000 },
}))

vi.mock("@/lib/mcp/load-mcp-from-url", () => ({
  loadMCPToolsFromURL: vi.fn(),
}))

const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

function makeRequest(body: unknown): Request {
  return new Request("http://test.local/api/mcp-servers/test", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

describe("/api/mcp-servers/test route", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    consoleErrorSpy.mockClear()
  })

  it("returns 400 for malformed JSON without testing the MCP connection", async () => {
    const response = await POST(
      new Request("http://test.local/api/mcp-servers/test", {
        method: "POST",
        body: "{",
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "Request body is not valid JSON",
      success: false,
    })
    expect(loadMCPToolsFromURL).not.toHaveBeenCalled()
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it("returns 400 for MCP URL policy rejections without logging a server error", async () => {
    vi.mocked(loadMCPToolsFromURL).mockRejectedValue(
      new McpUrlValidationError("Private IP addresses are not allowed")
    )

    const response = await POST(
      makeRequest({ url: "http://169.254.169.254/latest/meta-data/" })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "Private IP addresses are not allowed",
      success: false,
    })
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it("keeps unexpected MCP connection failures as 500s", async () => {
    const error = new Error("Connection failed")
    vi.mocked(loadMCPToolsFromURL).mockRejectedValue(error)

    const response = await POST(makeRequest({ url: "https://mcp.example.com" }))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: "Connection failed",
      success: false,
    })
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Error in POST /api/mcp-servers/test:",
      error
    )
  })

  it("tests an edited server with its owner-checked stored credential", async () => {
    routeMocks.query.mockResolvedValue({
      url: "https://mcp.example.com",
      authType: "bearer",
      encryptedAuthValue: "encrypted",
      authIv: "iv",
      headerName: undefined,
    })
    routeMocks.buildStoredMcpAuthHeaders.mockReturnValue({
      Authorization: "Bearer stored-token",
    })
    vi.mocked(loadMCPToolsFromURL).mockResolvedValue({
      tools: { search: {} },
      close: vi.fn(async () => {}),
    } as never)

    const response = await POST(
      makeRequest({
        serverId: "server-1",
        url: "https://mcp.example.com",
        transport: "http",
        authType: "bearer",
      })
    )

    expect(response.status).toBe(200)
    expect(routeMocks.query).toHaveBeenCalledWith(expect.anything(), {
      serverId: "server-1",
    })
    expect(routeMocks.buildStoredMcpAuthHeaders).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://mcp.example.com",
        authType: "bearer",
      }),
      "user-1"
    )
    expect(loadMCPToolsFromURL).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { Authorization: "Bearer stored-token" },
      })
    )
  })

  it("does not send a stored credential to an edited server URL", async () => {
    routeMocks.query.mockResolvedValue({
      url: "https://saved.example.com/mcp",
      authType: "bearer",
      encryptedAuthValue: "encrypted",
      authIv: "iv",
      headerName: undefined,
    })

    const response = await POST(
      makeRequest({
        serverId: "server-1",
        url: "https://edited.example.com/mcp",
        authType: "bearer",
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error:
        "Stored credentials can only be tested against the saved server URL",
      success: false,
    })
    expect(routeMocks.buildStoredMcpAuthHeaders).not.toHaveBeenCalled()
    expect(loadMCPToolsFromURL).not.toHaveBeenCalled()
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it("does not reveal or test a stored server the caller cannot read", async () => {
    routeMocks.query.mockResolvedValue(null)

    const response = await POST(
      makeRequest({
        serverId: "server-other",
        url: "https://mcp.example.com",
        authType: "bearer",
      })
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: "Server not found",
      success: false,
    })
    expect(routeMocks.buildStoredMcpAuthHeaders).not.toHaveBeenCalled()
    expect(loadMCPToolsFromURL).not.toHaveBeenCalled()
  })

  it("returns 400 when an edited server has no stored credential to reuse", async () => {
    routeMocks.query.mockResolvedValue({
      url: "https://mcp.example.com",
      authType: "bearer",
      encryptedAuthValue: undefined,
      authIv: undefined,
      headerName: undefined,
    })

    const response = await POST(
      makeRequest({
        serverId: "server-1",
        url: "https://mcp.example.com",
        authType: "bearer",
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "Cannot load MCP auth headers: missing encrypted credential",
      success: false,
    })
    expect(routeMocks.buildStoredMcpAuthHeaders).not.toHaveBeenCalled()
    expect(loadMCPToolsFromURL).not.toHaveBeenCalled()
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })
})
