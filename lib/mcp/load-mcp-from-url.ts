import { MCP_CONNECTION_TIMEOUT_MS } from "@/lib/config"
import { createMCPClient } from "@ai-sdk/mcp"
import { createPinnedMcpFetch } from "./pinned-fetch"
import { resolveMcpUrlForConnection } from "./url-validation"

export type McpTransportConfig = {
  url: string
  /** @default "http" — preferred per Vercel guidance (lower CPU than SSE) */
  transport?: "http" | "sse"
  headers?: Record<string, string>
  /** Deadline for URL validation, connection, and tool discovery together. */
  timeout?: number
}

export async function loadMCPToolsFromURL(config: string | McpTransportConfig) {
  const normalized: McpTransportConfig =
    typeof config === "string" ? { url: config } : config

  const {
    url,
    transport = "http",
    headers,
    timeout = MCP_CONNECTION_TIMEOUT_MS,
  } = normalized
  const lifetime = new AbortController()
  let client: Awaited<ReturnType<typeof createMCPClient>> | undefined
  let closing: Promise<void> | undefined

  function close(): Promise<void> {
    if (!client) return Promise.resolve()
    const openedClient = client
    return (closing ??= (async () => {
      // Bound the SDK's best-effort session DELETE as well as local teardown.
      const timer = setTimeout(() => lifetime.abort(), timeout)
      try {
        await openedClient.close()
      } finally {
        clearTimeout(timer)
        lifetime.abort()
      }
    })())
  }

  async function prepare() {
    const resolvedUrl = await resolveMcpUrlForConnection(url)
    lifetime.signal.throwIfAborted()
    const pinnedFetch = createPinnedMcpFetch(resolvedUrl)
    client = await createMCPClient({
      initializationOptions: { signal: lifetime.signal },
      transport: {
        type: transport,
        url,
        // Keep DNS pinning and redirect rejection; cancellation also reaches
        // tool discovery and response bodies, not just the caller's wait.
        fetch: (input, init) => {
          const requestSignal =
            init?.signal ??
            (input instanceof Request ? input.signal : undefined)
          return pinnedFetch(input, {
            ...init,
            signal: requestSignal
              ? AbortSignal.any([requestSignal, lifetime.signal])
              : lifetime.signal,
          })
        },
        ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
      },
    })
    // A transport may finish opening after the deadline despite cancellation.
    if (lifetime.signal.aborted) {
      void close().catch(() => {})
      lifetime.signal.throwIfAborted()
    }
    const tools = await client.tools()
    return { tools, close }
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      prepare(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("MCP connection timeout")),
          timeout
        )
      }),
    ])
  } catch (error) {
    lifetime.abort(error)
    // Failed preparation must not wait for a remote server's cleanup.
    void close().catch(() => {})
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export type McpConnection = Awaited<ReturnType<typeof loadMCPToolsFromURL>>
