import { afterEach, describe, expect, it, vi } from "vitest"
import { loadMCPToolsFromURL } from "../load-mcp-from-url"

const { transportFetch } = vi.hoisted(() => ({
  transportFetch: vi.fn<typeof fetch>(),
}))

vi.mock("node:dns/promises", () => ({
  resolve4: async () => ["93.184.216.34"],
  resolve6: async () => [],
}))

// Keep the real SDK; replace only the network behind the pinned fetch seam.
vi.mock("../pinned-fetch", () => ({
  createPinnedMcpFetch: () => transportFetch,
}))

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("MCP connection through the AI SDK", () => {
  it.each(["discovery", "close"] as const)(
    "bounds the real SDK's %s request",
    async (phase) => {
      vi.useFakeTimers()
      let pendingSignal: AbortSignal | null | undefined
      let requestAborted = false
      function pendingRequest(signal: AbortSignal | null | undefined) {
        pendingSignal = signal
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => {
              requestAborted = true
              reject(signal.reason)
            },
            { once: true }
          )
        })
      }
      transportFetch.mockImplementation(async (_input, init) => {
        if (phase === "close" && init?.method === "DELETE") {
          return pendingRequest(init.signal)
        }
        if (init?.method !== "POST") {
          return new Response(null, { status: 405 })
        }
        const message = JSON.parse(String(init.body)) as {
          id?: number
          method: string
        }
        if (message.method === "tools/list") {
          return phase === "discovery"
            ? pendingRequest(init.signal)
            : Response.json({
                jsonrpc: "2.0",
                id: message.id,
                result: { tools: [] },
              })
        }
        if (message.id === undefined) {
          return new Response(null, { status: 202 })
        }
        return Response.json(
          {
            jsonrpc: "2.0",
            id: message.id,
            ...(message.method === "initialize"
              ? {
                  result: {
                    protocolVersion: "2025-11-25",
                    capabilities: { tools: {} },
                    serverInfo: { name: "controlled-server", version: "1" },
                  },
                }
              : { error: { code: -32601, message: "Method not found" } }),
          },
          { headers: { "Mcp-Session-Id": "test-session" } }
        )
      })

      const pending = loadMCPToolsFromURL({
        url: "https://mcp.example.com",
        timeout: 50,
      })
      const settled =
        phase === "discovery"
          ? expect(pending).rejects.toThrow("MCP connection timeout")
          : pending.then(async (connection) => {
              await connection.close()
              await connection.close()
            })
      await vi.advanceTimersByTimeAsync(0)
      expect(pendingSignal).toBeInstanceOf(AbortSignal)
      expect(pendingSignal?.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(50)
      await settled
      expect(requestAborted).toBe(true)
      expect(pendingSignal?.aborted).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    }
  )
})
