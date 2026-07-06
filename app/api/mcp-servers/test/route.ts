import { authenticatedRoute } from "@/app/api/_lib/authenticated-route"
import { MCP_CONNECTION_TIMEOUT_MS } from "@/lib/config"
import { loadMCPToolsFromURL } from "@/lib/mcp/load-mcp-from-url"
import { McpUrlValidationError } from "@/lib/mcp/url-validation"
import { NextResponse } from "next/server"

type TestMCPServerRequestBody = {
  url?: string
  transport?: string
  authType?: string
  authValue?: string
  headerName?: string
}

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
      let body: TestMCPServerRequestBody
      try {
        body = (await request.json()) as TestMCPServerRequestBody
      } catch (error) {
        if (error instanceof SyntaxError) {
          return NextResponse.json(
            { error: "Request body is not valid JSON", success: false },
            { status: 400 }
          )
        }
        throw error
      }

      const { url, transport, authType, authValue, headerName } = body

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
      const message =
        error instanceof Error ? error.message : "Connection failed"
      if (error instanceof McpUrlValidationError) {
        return NextResponse.json(
          { error: message, success: false },
          { status: 400 }
        )
      }

      console.error("Error in POST /api/mcp-servers/test:", error)
      return NextResponse.json(
        { error: message, success: false },
        { status: 500 }
      )
    }
  },
  { rateLimit: { bucket: "mcp_test" } }
)
