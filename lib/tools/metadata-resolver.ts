import type { ServerInfo } from "@/lib/mcp/load-tools"
import type { ToolMetadata, ToolSource } from "./types"
import {
  humanizeToolName,
  toToolInvocationDisplayMetadata,
  type ToolInvocationMetadataByName,
} from "./ui-metadata"

/**
 * The Tool runtime's source-agnostic view of a single tool's metadata.
 *
 * A tool's facts live in two type shapes today: `ToolMetadata` (Layer 1
 * built-in, Layer 2 third-party/content) and `ServerInfo` (Layer 3 MCP). This
 * is the one shape they resolve into — the union of what call sites read —
 * regardless of which layer a tool came from.
 *
 * Trust is NOT baked in here. MCP risk hints
 * (`readOnly`/`destructive`/`idempotent`/`openWorld`) are carried VERBATIM
 * alongside the `policyHintsTrusted` flag; call sites apply trust exactly as
 * they did before (e.g. `getRuntimeToolApprovalDecision` takes
 * `riskHintsTrusted` separately, and the capability-policy join nulls out
 * untrusted hints itself). Pre-filtering here would silently change
 * untrusted-hint behavior.
 */
export type ResolvedToolMetadata = {
  /** Human-readable display name (humanized from the raw name for MCP tools). */
  displayName: string
  /** Tool source layer. */
  source: ToolSource
  /** Provider or service name (MCP tools use the configured server name). */
  serviceName: string
  /** Optional icon identifier for the UI (MCP tools use `"wrench"`). */
  icon?: ToolMetadata["icon"]
  /** Estimated cost per 1,000 invocations in USD (non-MCP only). */
  estimatedCostPer1k?: number
  /** Per-tool max result size in bytes override (non-MCP only). */
  maxResultSize?: number
  /** Whether the tool is read-only. Advisory for MCP tools. */
  readOnly?: boolean
  /** Whether the tool performs destructive updates. Advisory for MCP tools. */
  destructive?: boolean
  /** Whether repeated calls with the same input are safe. Advisory for MCP tools. */
  idempotent?: boolean
  /** Whether the tool reaches an open-world (external) context. Advisory for MCP tools. */
  openWorld?: boolean
  /**
   * MCP only: whether annotation hints are trusted for safety-critical risk
   * policy. Untrusted hints are still carried verbatim above for UI context.
   */
  policyHintsTrusted?: boolean
  /** MCP only: whether annotation hints are trusted for retry-safety decisions. */
  retrySafetyTrusted?: boolean
  /**
   * Present only for MCP (Layer 3) tools. `displayName` here is the original
   * un-namespaced tool name (mirrors `ServerInfo.displayName`), distinct from
   * the humanized top-level `displayName`.
   */
  mcpServer?: {
    serverId: string
    serverName: string
    displayName: string
  }
}

/**
 * Resolves a tool name to its unified metadata, regardless of source layer.
 * Replaces the per-call-site hand-joins across the four metadata maps.
 */
export type ToolMetadataResolver = {
  /**
   * Unified lookup across all layers. MCP wins name collisions (consulted
   * first), matching the prior `sourceForTool` / approval-loop precedence.
   * Which layer a tool came from is internal — Tool outcome recording and
   * approval decisions both resolve through this one lookup.
   */
  get(toolName: string): ResolvedToolMetadata | undefined
  /**
   * Source for the tool. MCP-first, falling back to `"platform"` for unknown
   * tools — the absorbed `sourceForTool` logic.
   */
  source(toolName: string): ToolSource
  /**
   * Transport-safe by-name display metadata projected from resolved records.
   */
  toInvocationMetadataByName(): ToolInvocationMetadataByName
}

function resolveFromToolMetadata(meta: ToolMetadata): ResolvedToolMetadata {
  return {
    displayName: meta.displayName,
    source: meta.source,
    serviceName: meta.serviceName,
    icon: meta.icon,
    estimatedCostPer1k: meta.estimatedCostPer1k,
    maxResultSize: meta.maxResultSize,
    readOnly: meta.readOnly,
    destructive: meta.destructive,
    idempotent: meta.idempotent,
    openWorld: meta.openWorld,
  }
}

function resolveFromServerInfo(info: ServerInfo): ResolvedToolMetadata {
  // MCP display facts are resolved here once; risk hints stay VERBATIM so
  // policy call sites can apply trust independently.
  return {
    displayName: humanizeToolName(info.displayName),
    source: "mcp",
    serviceName: info.serverName,
    icon: "wrench",
    readOnly: info.readOnly,
    destructive: info.destructive,
    idempotent: info.idempotent,
    openWorld: info.openWorld,
    policyHintsTrusted: info.policyHintsTrusted,
    retrySafetyTrusted: info.retrySafetyTrusted,
    mcpServer: {
      serverId: info.serverId,
      serverName: info.serverName,
      displayName: info.displayName,
    },
  }
}

export function createToolMetadataResolver(maps: {
  builtIn: ReadonlyMap<string, ToolMetadata>
  thirdParty: ReadonlyMap<string, ToolMetadata>
  content: ReadonlyMap<string, ToolMetadata>
  mcpToolServerMap: ReadonlyMap<string, ServerInfo>
}): ToolMetadataResolver {
  // Non-MCP merge: later layers win name collisions (built-in → third-party →
  // content), matching the prior `new Map([...builtIn, ...thirdParty, ...content])`.
  const nonMcp = new Map<string, ToolMetadata>([
    ...maps.builtIn,
    ...maps.thirdParty,
    ...maps.content,
  ])
  const mcp = maps.mcpToolServerMap

  function resolve(toolName: string): ResolvedToolMetadata | undefined {
    const info = mcp.get(toolName)
    if (info) return resolveFromServerInfo(info)
    const meta = nonMcp.get(toolName)
    return meta ? resolveFromToolMetadata(meta) : undefined
  }

  return {
    get: resolve,
    source(toolName) {
      return resolve(toolName)?.source ?? "platform"
    },
    toInvocationMetadataByName() {
      const byName: ToolInvocationMetadataByName = {}
      const toolNames = new Set([...nonMcp.keys(), ...mcp.keys()])

      for (const toolName of toolNames) {
        const metadata = resolve(toolName)
        if (metadata) {
          byName[toolName] = toToolInvocationDisplayMetadata(metadata)
        }
      }

      return byName
    },
  }
}
