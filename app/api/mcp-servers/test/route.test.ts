import { loadMCPToolsFromURL } from "@/lib/mcp/load-mcp-from-url"
import { McpUrlValidationError } from "@/lib/mcp/url-validation"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { POST } from "./route"

vi.mock("@/app/api/_lib/authenticated-route", () => ({
  authenticatedRoute:
    (handler: (req: Request, ctx: unknown) => Promise<Response> | Response) =>
    (req: Request) =>
      handler(req, {}),
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
})
