import { createMCPClient } from "@ai-sdk/mcp"
import { createPinnedMcpFetch } from "./pinned-fetch"
import { resolveMcpUrlForConnection } from "./url-validation"

export type McpTransportConfig = {
  url: string
  /** @default "http" — preferred per Vercel guidance (lower CPU than SSE) */
  transport?: "http" | "sse"
  headers?: Record<string, string>
}

export async function loadMCPToolsFromURL(config: string | McpTransportConfig) {
  const normalized: McpTransportConfig =
    typeof config === "string" ? { url: config } : config

  const { url, transport = "http", headers } = normalized

  // SSRF gate — reject private/reserved hosts and DNS-rebinding targets, then
  // pin the MCP transport's socket lookup to the vetted address so validation
  // and connection cannot diverge via DNS rebinding.
  const resolvedUrl = await resolveMcpUrlForConnection(url)

  // @ai-sdk/mcp 2.x HTTP/SSE transports reject 3xx responses by default
  // (redirect: "error", an SSRF hardening). A server URL that redirects —
  // http→https upgrades, trailing-slash normalization — now fails loudly
  // here instead of being silently followed; point configs at the final URL.
  const mcpClient = await createMCPClient({
    transport: {
      type: transport,
      url,
      fetch: createPinnedMcpFetch(resolvedUrl),
      ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
    },
  })

  const tools = await mcpClient.tools()
  return { tools, client: mcpClient, close: () => mcpClient.close() }
}
