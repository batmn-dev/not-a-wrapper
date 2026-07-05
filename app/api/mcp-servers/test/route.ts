import { authenticatedRoute } from "@/app/api/_lib/authenticated-route"
import { MCP_CONNECTION_TIMEOUT_MS, MCP_TEST_RATE_LIMIT } from "@/lib/config"
import { loadMCPToolsFromURL } from "@/lib/mcp/load-mcp-from-url"
import { NextResponse } from "next/server"

/**
 * POST /api/mcp-servers/test
 *
 * Tests connectivity to an MCP server and discovers available tools.
 * Used by the Settings UI "Test Connection" button.
 *
 * Accepts raw auth values (not encrypted) since this is a transient test,
 * not persistent storage. The auth value is used only for the connection
 * attempt and then discarded. Auth + CSRF are enforced by the seam, the call is
 * per-user rate-limited (each call opens an outbound socket), and the
 * user-supplied URL is SSRF-gated inside `loadMCPToolsFromURL`.
 */
export const POST = authenticatedRoute(
  async (request) => {
    try {
      const body = await request.json()
      const { url, transport, authType, authValue, headerName } = body as {
        url?: string
        transport?: string
        authType?: string
        authValue?: string
        headerName?: string
      }

      if (!url?.trim()) {
        return NextResponse.json(
          { error: "URL is required", success: false },
          { status: 400 }
        )
      }

      // Build auth headers from raw values
      let headers: Record<string, string> | undefined
      if (authType === "bearer" && authValue) {
        headers = { Authorization: `Bearer ${authValue}` }
      } else if (authType === "header" && headerName && authValue) {
        headers = { [headerName]: authValue }
      }

      // Attempt connection with timeout
      const result = await Promise.race([
        loadMCPToolsFromURL({
          url: url.trim(),
          transport: (transport === "sse" ? "sse" : "http") as "http" | "sse",
          headers,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Connection timed out")),
            MCP_CONNECTION_TIMEOUT_MS
          )
        ),
      ])

      const toolNames = Object.keys(result.tools)

      // Clean up the connection
      await result.close()

      return NextResponse.json({
        success: true,
        toolCount: toolNames.length,
        toolNames,
      })
    } catch (error) {
      console.error("Error in POST /api/mcp-servers/test:", error)
      const message =
        error instanceof Error ? error.message : "Connection failed"
      return NextResponse.json(
        { error: message, success: false },
        { status: 500 }
      )
    }
  },
  { rateLimit: { bucket: "mcp_test", ...MCP_TEST_RATE_LIMIT } }
)
