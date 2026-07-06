import { beforeEach, describe, expect, it, vi } from "vitest"
import { loadMCPToolsFromURL } from "../load-mcp-from-url"

const { mockCreateMCPClient, mockResolve4, mockResolve6 } = vi.hoisted(() => ({
  mockCreateMCPClient: vi.fn(),
  mockResolve4: vi.fn(),
  mockResolve6: vi.fn(),
}))

vi.mock("@ai-sdk/mcp", () => ({
  createMCPClient: (...args: unknown[]) => mockCreateMCPClient(...args),
}))

vi.mock("node:dns/promises", () => ({
  resolve4: mockResolve4,
  resolve6: mockResolve6,
}))

describe("loadMCPToolsFromURL", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolve4.mockResolvedValue(["93.184.216.34"])
    mockResolve6.mockRejectedValue(new Error("ENOTFOUND"))
    mockCreateMCPClient.mockResolvedValue({
      tools: vi.fn().mockResolvedValue({}),
      close: vi.fn().mockResolvedValue(undefined),
    })
  })

  it("passes a pinned fetch into the MCP transport after URL validation", async () => {
    await loadMCPToolsFromURL({
      url: "https://mcp.example.com",
      transport: "sse",
      headers: { Authorization: "Bearer test-token" },
    })

    expect(mockCreateMCPClient).toHaveBeenCalledWith({
      transport: {
        type: "sse",
        url: "https://mcp.example.com",
        headers: { Authorization: "Bearer test-token" },
        fetch: expect.any(Function),
      },
    })
  })
})
