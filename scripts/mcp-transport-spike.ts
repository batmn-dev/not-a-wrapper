/**
 * MCP Transport Spike — Phase 0
 *
 * Verifies that `type: 'http'` transport works with @ai-sdk/mcp v1.0.18.
 * Falls back to `type: 'sse'` if HTTP fails.
 *
 * Usage:
 *   bun run scripts/mcp-transport-spike.ts <mcp-server-url>
 *
 * Example:
 *   bun run scripts/mcp-transport-spike.ts https://mcp.example.com/mcp
 *
 * Decision output:
 *   - "TRANSPORT_DECISION: http" — use `type: 'http'` for all phases
 *   - "TRANSPORT_DECISION: sse"  — use `type: 'sse'` for all phases
 */

import { createMCPClient } from "@ai-sdk/mcp"

const url = process.argv[2]

if (!url) {
  console.error(
    "Usage: bun run scripts/mcp-transport-spike.ts <mcp-server-url>"
  )
  console.error(
    "Example: bun run scripts/mcp-transport-spike.ts https://mcp.example.com/mcp"
  )
  process.exit(1)
}

async function testTransport(type: "http" | "sse", serverUrl: string) {
  console.log(`\n--- Testing transport: ${type} ---`)
  console.log(`URL: ${serverUrl}`)

  try {
    const client = await createMCPClient({
      transport: { type, url: serverUrl },
    })

    const tools = await client.tools()
    const toolNames = Object.keys(tools)

    console.log(`  Status: SUCCESS`)
    console.log(`  Tools discovered: ${toolNames.length}`)
    if (toolNames.length > 0) {
      console.log(
        `  Tool names: ${toolNames.slice(0, 10).join(", ")}${toolNames.length > 10 ? "..." : ""}`
      )
    }

    await client.close()
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.log(`  Status: FAILED`)
    console.log(`  Error: ${message}`)
    return false
  }
}

async function main() {
  console.log("=== MCP Transport Spike ===")
  console.log(`@ai-sdk/mcp version: 1.0.18 (pinned)`)
  console.log(`Target URL: ${url}`)

  // Test HTTP first (preferred per Vercel guidance)
  const httpWorks = await testTransport("http", url)

  if (httpWorks) {
    console.log("\n=== TRANSPORT_DECISION: http ===")
    console.log(
      "HTTP (Streamable HTTP) transport works. Use as primary for all phases."
    )
    process.exit(0)
  }

  // Fall back to SSE
  const sseWorks = await testTransport("sse", url)

  if (sseWorks) {
    console.log("\n=== TRANSPORT_DECISION: sse ===")
    console.log("SSE transport works. Use as fallback for all phases.")
    console.log("Update plan references from 'http' to 'sse'.")
    process.exit(0)
  }

  // Neither worked
  console.error("\n=== TRANSPORT_DECISION: FAILED ===")
  console.error("Neither HTTP nor SSE transport worked with the provided URL.")
  console.error("Verify the URL is a valid MCP server endpoint.")
  process.exit(1)
}

main()
