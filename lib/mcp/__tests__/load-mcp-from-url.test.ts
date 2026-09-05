import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockResolve4.mockResolvedValue(["93.184.216.34"])
    mockResolve6.mockRejectedValue(new Error("ENOTFOUND"))
    mockCreateMCPClient.mockResolvedValue({
      tools: vi.fn().mockResolvedValue({}),
      close: vi.fn().mockResolvedValue(undefined),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("passes a pinned fetch into the MCP transport after URL validation", async () => {
    await loadMCPToolsFromURL({
      url: "https://mcp.example.com",
      transport: "sse",
      headers: { Authorization: "Bearer test-token" },
    })

    expect(mockCreateMCPClient).toHaveBeenCalledWith({
      initializationOptions: { signal: expect.any(AbortSignal) },
      transport: {
        type: "sse",
        url: "https://mcp.example.com",
        headers: { Authorization: "Bearer test-token" },
        fetch: expect.any(Function),
      },
    })
  })

  it("keeps a ready connection alive past preparation and closes it once", async () => {
    const client = { tools: vi.fn().mockResolvedValue({}), close: vi.fn() }
    mockCreateMCPClient.mockResolvedValue(client)
    const result = await loadMCPToolsFromURL({
      url: "https://mcp.example.com",
      timeout: 50,
    })
    const { signal } =
      mockCreateMCPClient.mock.calls[0][0].initializationOptions
    await vi.advanceTimersByTimeAsync(100)
    expect(signal.aborted).toBe(false)
    await Promise.all([result.close(), result.close()])
    expect(client.close).toHaveBeenCalledTimes(1)
    expect(signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("includes DNS in the deadline and never connects after late resolution", async () => {
    const dns = Promise.withResolvers<string[]>()
    mockResolve4.mockReturnValue(dns.promise)
    const result = loadMCPToolsFromURL({
      url: "https://mcp.example.com",
      timeout: 50,
    })
    const rejected = expect(result).rejects.toThrow("MCP connection timeout")
    await vi.advanceTimersByTimeAsync(50)
    await rejected
    dns.resolve(["93.184.216.34"])
    await vi.advanceTimersByTimeAsync(0)
    expect(mockCreateMCPClient).not.toHaveBeenCalled()
  })

  it("closes a client that finishes connecting after its deadline", async () => {
    const client = {
      tools: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    }
    const connection = Promise.withResolvers<typeof client>()
    mockCreateMCPClient.mockReturnValue(connection.promise)
    const result = loadMCPToolsFromURL({
      url: "https://mcp.example.com",
      timeout: 50,
    })
    const rejected = expect(result).rejects.toThrow("MCP connection timeout")
    await vi.advanceTimersByTimeAsync(50)
    await rejected
    connection.resolve(client)
    await vi.advanceTimersByTimeAsync(0)
    expect(client.tools).not.toHaveBeenCalled()
    expect(client.close).toHaveBeenCalledTimes(1)
  })

  it("closes discovery failures without masking the original error", async () => {
    const client = {
      tools: vi.fn().mockRejectedValue(new Error("Discovery failed")),
      close: vi.fn().mockRejectedValue(new Error("Close failed")),
    }
    mockCreateMCPClient.mockResolvedValue(client)
    await expect(
      loadMCPToolsFromURL("https://mcp.example.com")
    ).rejects.toThrow("Discovery failed")
    expect(client.close).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("aborts discovery at the remaining deadline, not a fresh timeout", async () => {
    const client = {
      tools: vi.fn(() => new Promise(() => {})),
      close: vi.fn().mockResolvedValue(undefined),
    }
    mockCreateMCPClient.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(client), 30))
    )
    const result = loadMCPToolsFromURL({
      url: "https://mcp.example.com",
      timeout: 50,
    })
    const rejected = expect(result).rejects.toThrow("MCP connection timeout")
    await vi.advanceTimersByTimeAsync(30)
    expect(client.tools).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(20)
    await rejected
    expect(
      mockCreateMCPClient.mock.calls[0][0].initializationOptions.signal.aborted
    ).toBe(true)
    expect(client.close).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
