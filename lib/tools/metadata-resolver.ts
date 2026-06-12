// lib/tools/metadata-resolver.ts

import type { ServerInfo } from "@/lib/mcp/load-tools"
import type { ToolMetadata, ToolSource } from "./types"
import {
  buildToolInvocationMetadataByName,
  humanizeToolName,
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
   */
  get(toolName: string): ResolvedToolMetadata | undefined
  /**
   * Non-MCP lookup only — the exact mirror of the prior `allToolMetadata.get`.
   * Returns `undefined` for MCP tools and unknown tools alike, so sites that
   * deliberately ignore MCP metadata (tool_trace logging, the non-MCP audit
   * log) keep identical behavior.
   */
  getNonMcp(toolName: string): ResolvedToolMetadata | undefined
  /** Whether the tool exists in any layer's metadata. */
  has(toolName: string): boolean
  /** Whether the tool is an MCP (Layer 3) tool. */
  isMcp(toolName: string): boolean
  /**
   * Source for the tool. MCP-first, falling back to `"platform"` for unknown
   * tools — the absorbed `sourceForTool` logic.
   */
  source(toolName: string): ToolSource
  /** Distinct tool names across all layers. */
  readonly size: number
  /**
   * Non-MCP tool count — the exact mirror of the prior `allToolMetadata.size`.
   * Use for the audit-log guard so its meaning (non-MCP only) is preserved.
   */
  readonly sizeNonMcp: number
  /**
   * Transport-safe by-name display metadata. Delegates to the unchanged
   * `buildToolInvocationMetadataByName`, so the persisted/streamed shape stays
   * byte-for-byte identical.
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
  // Mirror `toMcpDisplayMetadata`: humanized name, server-derived service name,
  // wrench icon, and risk hints carried VERBATIM (no trust filtering).
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

  return {
    get(toolName) {
      const info = mcp.get(toolName)
      if (info) return resolveFromServerInfo(info)
      const meta = nonMcp.get(toolName)
      return meta ? resolveFromToolMetadata(meta) : undefined
    },
    getNonMcp(toolName) {
      const meta = nonMcp.get(toolName)
      return meta ? resolveFromToolMetadata(meta) : undefined
    },
    has(toolName) {
      return mcp.has(toolName) || nonMcp.has(toolName)
    },
    isMcp(toolName) {
      return mcp.has(toolName)
    },
    source(toolName) {
      if (mcp.has(toolName)) return "mcp"
      return nonMcp.get(toolName)?.source ?? "platform"
    },
    get size() {
      let count = nonMcp.size
      for (const name of mcp.keys()) {
        if (!nonMcp.has(name)) count++
      }
      return count
    },
    get sizeNonMcp() {
      return nonMcp.size
    },
    toInvocationMetadataByName() {
      return buildToolInvocationMetadataByName({
        nonMcpMetadata: nonMcp,
        mcpToolServerMap: mcp,
      })
    },
  }
}
