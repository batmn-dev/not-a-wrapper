import { decryptSecret } from "@/lib/encryption"

export type McpAuthConfiguration = {
  authType?: "none" | "bearer" | "header"
  encryptedAuthValue?: string
  authIv?: string
  headerName?: string
}

/**
 * Build connection headers from an owner-bound stored MCP credential. Both
 * Chat tool loading and edit-mode connection tests call this implementation
 * only after the server row's ownership has been resolved.
 */
export function buildStoredMcpAuthHeaders(
  server: McpAuthConfiguration,
  ownerId?: string
): Record<string, string> | undefined {
  if (!server.authType || server.authType === "none") return undefined
  if (!ownerId) {
    throw new Error("Cannot load MCP auth headers: missing owner identity")
  }
  if (!server.encryptedAuthValue || !server.authIv) {
    throw new Error(
      "Cannot load MCP auth headers: missing encrypted credential"
    )
  }
  if (server.authType === "header" && !server.headerName) {
    throw new Error("Cannot load MCP auth headers: missing header name")
  }

  try {
    const decryptedValue = decryptSecret(
      server.encryptedAuthValue,
      server.authIv,
      { kind: "mcpAuth", ownerId }
    )
    if (server.authType === "bearer") {
      return { Authorization: `Bearer ${decryptedValue}` }
    }
    if (server.authType === "header") {
      return { [server.headerName]: decryptedValue }
    }
  } catch (error) {
    console.error(
      "[MCP] Failed to decrypt auth for server:",
      error instanceof Error ? error.message : error
    )
    throw new Error("Failed to decrypt MCP auth headers")
  }
}
