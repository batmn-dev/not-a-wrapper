import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  MCP_CONNECTION_TIMEOUT_MS,
  MCP_MAX_TOOLS_PER_REQUEST,
  MCP_TRUSTED_RETRY_SERVER_ALLOWLIST,
} from "@/lib/config"
import { decryptSecret } from "@/lib/encryption"
import { createMCPClient } from "@ai-sdk/mcp"
import { fetchMutation, fetchQuery } from "convex/nextjs"
import { isCircuitOpen, recordFailure, recordSuccess } from "./circuit-breaker"
import { assertMcpUrlAllowed } from "./url-validation"

// =============================================================================
// Types
// =============================================================================

/** MCP client instance — inferred from createMCPClient return type */
type MCPClient = Awaited<ReturnType<typeof createMCPClient>>

/** Tool set returned by client.tools() — compatible with streamText() */
type MCPToolSet = Awaited<ReturnType<MCPClient["tools"]>>

/** Maps a namespaced tool name to its source server info */
export type ServerInfo = {
  /** Original tool name (without namespace prefix) */
  displayName: string
  /** Human-readable server name from user config */
  serverName: string
  /** Convex document ID of the MCP server */
  serverId: string
  /** Whether this tool is read-only (from MCP tool annotations) */
  readOnly?: boolean
  /** Whether this tool performs destructive actions (from MCP annotations) */
  destructive?: boolean
  /** Whether this tool is idempotent (from MCP annotations) */
  idempotent?: boolean
  /** Whether this tool operates in an open-world context (from MCP annotations) */
  openWorld?: boolean
  /**
   * Whether MCP annotation hints are trusted for retry safety decisions.
   * Hints are advisory by default and only become retry-driving when trusted.
   */
  retrySafetyTrusted?: boolean
  /**
   * Whether MCP annotation hints are trusted for safety-critical risk policy.
   * Untrusted hints are retained for UI context but ignored by gating policy.
   */
  policyHintsTrusted?: boolean
}

/** Result from loadUserMcpTools — everything the chat route needs */
export type LoadToolsResult = {
  /** Merged, namespaced tools from all enabled servers. Pass to streamText(). */
  tools: MCPToolSet
  /** Active MCP client connections. Must be closed after streaming via after(). */
  clients: MCPClient[]
  /** Namespaced tool name → server info. Used for UI display and audit logging. */
  toolServerMap: Map<string, ServerInfo>
  /** Number of enabled servers that failed to connect (rejected + circuit-breaker-skipped). */
  failedServerCount: number
}

export type LoadToolsOptions = {
  /** Per-server connection timeout in ms. @default MCP_CONNECTION_TIMEOUT_MS (5000) */
  timeout?: number
}

type NamespacedToolOwner = {
  serverId: string
  serverName: string
  displayName: string
}

type RetryTrustServer = {
  _id: string
  name: string
  url: string
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Minimal runtime guard — confirms a tool value has the shape streamText() expects.
 * Catches SDK breaking changes at the insertion point rather than inside streamText().
 */
function isToolDescriptor(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "execute" in value &&
    typeof (value as Record<string, unknown>).execute === "function"
  )
}

type ToolAnnotationHints = {
  // MCP annotations are optional, provider-defined hints.
  // Treat as advisory unless paired with an explicit trust context.
  readOnly?: boolean
  destructive?: boolean
  idempotent?: boolean
  openWorld?: boolean
}

function extractToolAnnotationHints(tool: unknown): ToolAnnotationHints {
  if (typeof tool !== "object" || tool === null) return {}

  const toolRecord = tool as Record<string, unknown>
  if (!("annotations" in toolRecord)) return {}

  const annotations = toolRecord.annotations as
    Record<string, unknown> | undefined
  if (!annotations) return {}

  return {
    readOnly:
      typeof annotations.readOnlyHint === "boolean"
        ? annotations.readOnlyHint
        : undefined,
    destructive:
      typeof annotations.destructiveHint === "boolean"
        ? annotations.destructiveHint
        : undefined,
    idempotent:
      typeof annotations.idempotentHint === "boolean"
        ? annotations.idempotentHint
        : undefined,
    openWorld:
      typeof annotations.openWorldHint === "boolean"
        ? annotations.openWorldHint
        : undefined,
  }
}

/**
 * Convert a server name to a stable URL-safe slug for tool namespacing.
 *
 * IMPORTANT: The slug must be deterministic and treated as immutable once tools
 * are used in a conversation. Changing the slug orphans historical tool names
 * stored in message history (tool-call and tool-result parts reference the
 * namespaced name).
 *
 * @example slugify("My GitHub Server") → "my_github_server"
 */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 30) || "server"
  )
}

function normalizeRetryTrustToken(value: string): string {
  return value.trim().toLowerCase()
}

function getServerHost(url: string): string | undefined {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return undefined
  }
}

function isRetrySafetyTrustedServer(server: RetryTrustServer): boolean {
  if (MCP_TRUSTED_RETRY_SERVER_ALLOWLIST.length === 0) return false

  const allowlist = new Set(MCP_TRUSTED_RETRY_SERVER_ALLOWLIST)
  const candidates = [
    normalizeRetryTrustToken(server._id),
    normalizeRetryTrustToken(server.name),
    normalizeRetryTrustToken(slugify(server.name)),
    getServerHost(server.url),
  ].filter((candidate): candidate is string => Boolean(candidate))

  return candidates.some((candidate) => allowlist.has(candidate))
}

/**
 * Build auth headers for an MCP server connection.
 * Decrypts the stored auth value using AES-256-GCM (same pattern as BYOK keys).
 */
function buildAuthHeaders(
  server: {
    authType?: "none" | "bearer" | "header"
    encryptedAuthValue?: string
    authIv?: string
    headerName?: string
  },
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

  try {
    const decryptedValue = decryptSecret(
      server.encryptedAuthValue,
      server.authIv,
      { kind: "mcpAuth", ownerId }
    )

    if (server.authType === "bearer") {
      return { Authorization: `Bearer ${decryptedValue}` }
    }

    if (server.authType === "header" && server.headerName) {
      return { [server.headerName]: decryptedValue }
    }
  } catch (error) {
    console.error(
      "[MCP] Failed to decrypt auth for server:",
      error instanceof Error ? error.message : error
    )
    throw new Error("Failed to decrypt MCP auth headers")
  }

  throw new Error("Cannot load MCP auth headers: missing header name")
}

/**
 * Translate an MCP connection failure into the message stored as the server's
 * `lastError` (shown in MCP settings). Most errors pass through verbatim; a
 * redirect rejection is rewritten because the raw fetch error ("fetch failed"
 * on Node, "UnexpectedRedirect fetching …" on Bun) does not tell the user
 * what to fix. @ai-sdk/mcp 2.x rejects 3xx responses by default
 * (redirect: "error") where 1.x silently followed them — kept as-is here
 * because auto-following would re-send decrypted auth headers to the redirect
 * target and bypass the pre-connect DNS/private-IP validation.
 */
export function describeMcpConnectionError(reason: unknown): string {
  let cause: unknown = reason
  while (cause instanceof Error) {
    if (/redirect/i.test(cause.message)) {
      return (
        "Server URL responded with a redirect, which MCP connections do not " +
        "follow. Update the server URL to its final address (e.g. use " +
        "https:// and the exact path the server reports)."
      )
    }
    cause = cause.cause
  }
  return reason instanceof Error ? reason.message : "Connection failed"
}

/**
 * Update MCP server connection status (best-effort, non-blocking).
 * Failures are silently caught — these are observability updates, not critical path.
 */
function updateConnectionStatus(
  serverId: Id<"mcpServers">,
  status: { lastConnectedAt?: number; lastError?: string },
  token: string
): void {
  void fetchMutation(
    api.mcpServers.updateConnectionStatus,
    { serverId, ...status },
    { token }
  ).catch(() => {
    // Intentionally swallowed — connection status updates are best-effort
  })
}

// =============================================================================
// Main Orchestrator
// =============================================================================

/**
 * Load MCP tools for a user's enabled servers.
 *
 * This is the core orchestration layer for Phase 3 of MCP integration.
 * Called once per chat request when MCP is enabled.
 *
 * **Flow**:
 * 1. Fetch user's enabled server configs + tool approvals from Convex (parallel)
 * 2. Create MCP clients in parallel with per-server timeout
 * 3. Collect and namespace tools from successful connections
 * 4. Filter by approval status (v1: default auto-approved)
 * 5. Enforce per-request tool limit
 *
 * **Latency**: ~500ms-2s depending on server count and responsiveness.
 * Total = max(Convex query, max(individual server connections)).
 *
 * **Error handling**: Failed servers are skipped gracefully. If ALL servers
 * fail, returns empty tools (the chat proceeds without tool capabilities).
 *
 * **Cleanup**: Callers MUST close returned clients after streaming via `after()`.
 *
 * @param convexToken - Convex auth token for user identity resolution
 * @param options - Optional configuration overrides
 */
export async function loadUserMcpTools(
  convexToken: string,
  options: LoadToolsOptions = {}
): Promise<LoadToolsResult> {
  const timeout = options.timeout ?? MCP_CONNECTION_TIMEOUT_MS

  const emptyResult: LoadToolsResult = {
    tools: {} as MCPToolSet,
    clients: [],
    toolServerMap: new Map(),
    failedServerCount: 0,
  }

  // -------------------------------------------------------------------------
  // 1. Load server configs + tool approvals in parallel (~50-100ms Convex RTT)
  // -------------------------------------------------------------------------
  const [allServers, allApprovals, currentUser] = await Promise.all([
    fetchQuery(api.mcpServers.list, {}, { token: convexToken }),
    fetchQuery(api.mcpToolApprovals.listByUser, {}, { token: convexToken }),
    fetchQuery(api.users.getCurrent, {}, { token: convexToken }),
  ])

  // Owner's WorkOS subject — the AAD binding the stored auth values were
  // encrypted under. Without it we cannot decrypt server auth headers.
  const ownerId = currentUser?.workosUserId

  const enabledServers = allServers.filter((s) => s.enabled)
  if (enabledServers.length === 0) return emptyResult

  // Build approval lookup: `serverId_toolName` → approved
  const approvalMap = new Map<string, boolean>()
  for (const approval of allApprovals) {
    approvalMap.set(
      `${approval.serverId}_${approval.toolName}`,
      approval.approved
    )
  }

  // -------------------------------------------------------------------------
  // 2. Filter out servers with open circuits (too many consecutive failures)
  // -------------------------------------------------------------------------
  let circuitBreakerSkipped = 0
  const serversToConnect = enabledServers.filter((server) => {
    if (isCircuitOpen(server._id)) {
      console.warn(
        `[MCP] Circuit open for "${server.name}" (consecutive failures >= threshold), skipping`
      )
      circuitBreakerSkipped++
      return false
    }
    return true
  })

  if (serversToConnect.length === 0) {
    return { ...emptyResult, failedServerCount: circuitBreakerSkipped }
  }

  // -------------------------------------------------------------------------
  // 3. Create MCP clients in parallel with per-server timeout
  //    Total time = max(individual server times), not sum.
  //    A slow server doesn't block fast servers.
  // -------------------------------------------------------------------------
  const clientResults = await Promise.allSettled(
    serversToConnect.map(async (server) => {
      // SSRF gate — string + DNS-rebinding checks. Shared with the transient
      // test-connection path so both routes enforce one policy. A stored URL
      // passed the string check at create time, but re-run it here: DNS can
      // rebind and the create-time check can be bypassed by calling the Convex
      // mutation directly.
      await assertMcpUrlAllowed(server.url)

      const headers = buildAuthHeaders(server, ownerId)

      // Hold a reference to the client promise so we can clean up orphaned
      // connections when the timeout wins the race (prevents resource leaks).
      // Note: @ai-sdk/mcp 2.x HTTP/SSE transports reject 3xx responses by
      // default (redirect: "error") — deliberate here; see
      // describeMcpConnectionError for the rationale and the user-facing error.
      const clientPromise = createMCPClient({
        transport: {
          type: server.transport,
          url: server.url,
          ...(headers ? { headers } : {}),
        },
      })

      try {
        return await Promise.race([
          clientPromise,
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("MCP connection timeout")),
              timeout
            )
          ),
        ])
      } catch (error) {
        // When timeout wins the race, createMCPClient may still be in-flight.
        // If it eventually resolves, the client would never be closed — resource leak.
        // Attach a cleanup handler to close any orphaned client.
        clientPromise.then(
          (orphanedClient) => void orphanedClient.close().catch(() => {}),
          () => {} // Client also failed — nothing to clean up
        )
        throw error
      }
    })
  )

  // -------------------------------------------------------------------------
  // 4. Collect tools from successful clients
  // -------------------------------------------------------------------------
  const clients: MCPClient[] = []
  // MCPToolSet is an opaque mapped type from @ai-sdk/mcp that does not expose a
  // mutable builder interface. We accumulate tools as Record<string, unknown> and
  // cast to MCPToolSet at the return boundary — this is the only safe escape hatch
  // without introducing a runtime wrapper around each tool descriptor.
  const mergedTools: Record<string, unknown> = {}
  const toolServerMap = new Map<string, ServerInfo>()
  const namespacedOwners = new Map<string, NamespacedToolOwner>()
  const namespacedCollisionOwners = new Map<string, NamespacedToolOwner[]>()
  const collidingNames = new Set<string>()
  let toolCount = 0
  let connectionFailures = 0

  for (let i = 0; i < clientResults.length; i++) {
    const result = clientResults[i]
    const server = serversToConnect[i]

    // --- Failed connection: log, record failure for circuit breaker, skip ---
    if (result.status === "rejected") {
      const errorMsg = describeMcpConnectionError(result.reason)

      console.error(`[MCP] Connection failed for "${server.name}":`, errorMsg)
      recordFailure(server._id)
      updateConnectionStatus(server._id, { lastError: errorMsg }, convexToken)
      connectionFailures++
      continue
    }

    // --- Successful connection: reset circuit breaker ---
    const client = result.value
    clients.push(client)
    recordSuccess(server._id)

    try {
      const tools = await client.tools()
      const serverSlug = slugify(server.name)
      const retrySafetyTrusted = isRetrySafetyTrustedServer(server)

      // Update successful connection status (best-effort)
      updateConnectionStatus(
        server._id,
        { lastConnectedAt: Date.now() },
        convexToken
      )

      for (const [toolName, tool] of Object.entries(tools)) {
        // 4. Filter by approved tools (v1: default auto-approved if no record)
        const approvalKey = `${server._id}_${toolName}`
        const isApproved = approvalMap.get(approvalKey) ?? true
        if (!isApproved) continue

        // 5. Enforce per-request tool limit
        if (toolCount >= MCP_MAX_TOOLS_PER_REQUEST) {
          console.warn(
            `[MCP] Tool limit (${MCP_MAX_TOOLS_PER_REQUEST}) reached, ` +
              `skipping remaining tools from "${server.name}"`
          )
          break
        }

        // 6. Runtime shape check — skip malformed descriptors
        if (!isToolDescriptor(tool)) {
          console.warn(
            `[MCP] Skipping tool "${toolName}" from "${server.name}": unexpected descriptor shape`
          )
          continue
        }

        // 7. Read MCP annotation hints.
        // These are advisory/untrusted by default and may be absent.
        // Downstream policy and retry code must fail safe without them.
        const annotationHints = extractToolAnnotationHints(tool)

        // 8. Namespace tool name: `${serverSlug}_${toolName}`
        const namespacedName = `${serverSlug}_${toolName}`
        const owner: NamespacedToolOwner = {
          serverId: server._id,
          serverName: server.name,
          displayName: toolName,
        }

        if (collidingNames.has(namespacedName)) {
          const existing = namespacedCollisionOwners.get(namespacedName) ?? []
          namespacedCollisionOwners.set(namespacedName, [...existing, owner])
          continue
        }

        if (mergedTools[namespacedName]) {
          collidingNames.add(namespacedName)
          const previousOwner = namespacedOwners.get(namespacedName)
          namespacedCollisionOwners.set(
            namespacedName,
            previousOwner ? [previousOwner, owner] : [owner]
          )

          delete mergedTools[namespacedName]
          toolServerMap.delete(namespacedName)
          namespacedOwners.delete(namespacedName)
          toolCount = Math.max(0, toolCount - 1)
          continue
        }

        mergedTools[namespacedName] = tool
        toolServerMap.set(namespacedName, {
          displayName: toolName,
          serverName: server.name,
          serverId: server._id,
          readOnly: annotationHints.readOnly,
          destructive: annotationHints.destructive,
          idempotent: annotationHints.idempotent,
          openWorld: annotationHints.openWorld,
          retrySafetyTrusted,
          policyHintsTrusted: retrySafetyTrusted,
        })
        namespacedOwners.set(namespacedName, owner)
        toolCount++
      }
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : "Tool loading failed"

      console.error(
        `[MCP] Failed to load tools from "${server.name}":`,
        errorMsg
      )
      updateConnectionStatus(server._id, { lastError: errorMsg }, convexToken)
    }
  }

  for (const [namespacedName, owners] of namespacedCollisionOwners.entries()) {
    const distinctOwners = owners.filter(
      (owner, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.serverId === owner.serverId &&
            candidate.displayName === owner.displayName
        ) === index
    )
    console.warn(
      JSON.stringify({
        _tag: "mcp_tool_name_collision",
        namespacedName,
        ownerCount: distinctOwners.length,
        owners: distinctOwners,
        action: "drop_all_colliders",
      })
    )
  }

  return {
    tools: mergedTools as MCPToolSet,
    clients,
    toolServerMap,
    failedServerCount: connectionFailures + circuitBreakerSkipped,
  }
}
