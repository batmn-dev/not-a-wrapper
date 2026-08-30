import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  MCP_CONNECTION_TIMEOUT_MS,
  MCP_MAX_TOOLS_PER_REQUEST,
  MCP_TRUSTED_RETRY_SERVER_ALLOWLIST,
} from "@/lib/config"
import { createMCPClient } from "@ai-sdk/mcp"
import { fetchMutation, fetchQuery } from "convex/nextjs"
import { isCircuitOpen, recordFailure, recordSuccess } from "./circuit-breaker"
import { buildStoredMcpAuthHeaders } from "./auth-headers"
import { createPinnedMcpFetch } from "./pinned-fetch"
import { resolveMcpUrlForConnection } from "./url-validation"

type MCPClient = Awaited<ReturnType<typeof createMCPClient>>

type MCPToolSet = Awaited<ReturnType<MCPClient["tools"]>>

export type ServerInfo = {
  displayName: string
  serverName: string
  serverId: string
  readOnly?: boolean
  destructive?: boolean
  idempotent?: boolean
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

export type LoadToolsResult = {
  tools: MCPToolSet
  /** Active MCP client connections. Must be closed after streaming via after(). */
  clients: MCPClient[]
  toolServerMap: Map<string, ServerInfo>
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
 * Slugs are persisted in tool-call history; changing this algorithm orphans
 * historical tool names.
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

/** Connection status is best-effort and never blocks tool loading. */
function updateConnectionStatus(
  serverId: Id<"mcpServers">,
  status: { lastConnectedAt?: number; lastError?: string },
  token: string
): void {
  void fetchMutation(
    api.mcpServers.updateConnectionStatus,
    { serverId, ...status },
    { token }
  ).catch(() => {})
}

/**
 * Load MCP tools for a user's enabled servers.
 *
 * Server failures are isolated; all returned clients must be closed after the
 * stream. Namespacing and approval filtering precede the per-request tool cap.
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

  const approvalMap = new Map<string, boolean>()
  for (const approval of allApprovals) {
    approvalMap.set(
      `${approval.serverId}_${approval.toolName}`,
      approval.approved
    )
  }

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

  // Isolate slow servers with parallel, per-server timeouts.
  const clientResults = await Promise.allSettled(
    serversToConnect.map(async (server) => {
      // SSRF gate — string + DNS-rebinding checks. The returned address is also
      // pinned into the transport fetch so validation and connection cannot
      // diverge between check and use.
      const resolvedUrl = await resolveMcpUrlForConnection(server.url)

      const headers = buildStoredMcpAuthHeaders(server, ownerId)

      // Keep the losing promise so a late client can still be closed.
      // Note: @ai-sdk/mcp 2.x HTTP/SSE transports reject 3xx responses by
      // default (redirect: "error") — deliberate here; see
      // describeMcpConnectionError for the rationale and the user-facing error.
      const clientPromise = createMCPClient({
        transport: {
          type: server.transport,
          url: server.url,
          fetch: createPinnedMcpFetch(resolvedUrl),
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
        clientPromise.then(
          (orphanedClient) => void orphanedClient.close().catch(() => {}),
          () => {} // Client also failed — nothing to clean up
        )
        throw error
      }
    })
  )

  const clients: MCPClient[] = []
  // The SDK's opaque mapped type has no mutable builder interface.
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

    if (result.status === "rejected") {
      const errorMsg = describeMcpConnectionError(result.reason)

      console.error(`[MCP] Connection failed for "${server.name}":`, errorMsg)
      recordFailure(server._id)
      updateConnectionStatus(server._id, { lastError: errorMsg }, convexToken)
      connectionFailures++
      continue
    }

    const client = result.value
    clients.push(client)
    recordSuccess(server._id)

    try {
      const tools = await client.tools()
      const serverSlug = slugify(server.name)
      const retrySafetyTrusted = isRetrySafetyTrustedServer(server)

      updateConnectionStatus(
        server._id,
        { lastConnectedAt: Date.now() },
        convexToken
      )

      for (const [toolName, tool] of Object.entries(tools)) {
        // Missing approval rows default to approved.
        const approvalKey = `${server._id}_${toolName}`
        const isApproved = approvalMap.get(approvalKey) ?? true
        if (!isApproved) continue

        if (toolCount >= MCP_MAX_TOOLS_PER_REQUEST) {
          console.warn(
            `[MCP] Tool limit (${MCP_MAX_TOOLS_PER_REQUEST}) reached, ` +
              `skipping remaining tools from "${server.name}"`
          )
          break
        }

        if (!isToolDescriptor(tool)) {
          console.warn(
            `[MCP] Skipping tool "${toolName}" from "${server.name}": unexpected descriptor shape`
          )
          continue
        }

        // Annotation hints are untrusted unless server policy says otherwise.
        const annotationHints = extractToolAnnotationHints(tool)

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
