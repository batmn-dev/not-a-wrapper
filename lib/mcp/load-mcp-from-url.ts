import { createMCPClient } from "@ai-sdk/mcp"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type McpTransportConfig = {
  url: string
  /** @default "http" — preferred per Vercel guidance (lower CPU than SSE) */
  transport?: "http" | "sse"
  /** Optional auth/custom headers sent with every MCP request */
  headers?: Record<string, string>
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create an MCP client from a URL with optional transport type and auth headers.
 *
 * Supports both HTTP (recommended, ~50% lower CPU) and SSE (legacy) transports.
 * Returns the client reference for lifecycle management alongside discovered tools.
 *
 * @example
 * ```ts
 * // Simple (backward-compatible)
 * const { tools, close } = await loadMCPToolsFromURL("https://mcp.example.com")
 *
 * // With auth
 * const { tools, client, close } = await loadMCPToolsFromURL({
 *   url: "https://mcp.example.com",
 *   transport: "http",
 *   headers: { Authorization: "Bearer sk-..." },
 * })
 * ```
 */
export async function loadMCPToolsFromURL(config: string | McpTransportConfig) {
  const normalized: McpTransportConfig =
    typeof config === "string" ? { url: config } : config

  const { url, transport = "http", headers } = normalized

  // @ai-sdk/mcp 2.x HTTP/SSE transports reject 3xx responses by default
  // (redirect: "error", an SSRF hardening). A server URL that redirects —
  // http→https upgrades, trailing-slash normalization — now fails loudly
  // here instead of being silently followed; point configs at the final URL.
  const mcpClient = await createMCPClient({
    transport: {
      type: transport,
      url,
      ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
    },
  })

  const tools = await mcpClient.tools()
  return { tools, client: mcpClient, close: () => mcpClient.close() }
}
