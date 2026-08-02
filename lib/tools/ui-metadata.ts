import type { ServerInfo } from "@/lib/mcp/load-tools"
import type { ToolMetadata, ToolSource } from "./types"

export type ToolInvocationDisplayMetadata = {
  displayName: string
  source: ToolSource
  serviceName: string
  icon?: ToolMetadata["icon"]
  estimatedCostPer1k?: number
  readOnly?: boolean
  destructive?: boolean
  idempotent?: boolean
  openWorld?: boolean
}

export type ToolInvocationMetadataByName = Record<
  string,
  ToolInvocationDisplayMetadata
>

export type ToolInvocationMetadataByCallId = Record<
  string,
  ToolInvocationDisplayMetadata
>

export type ToolInvocationStreamMetadata = {
  reasoningDurationMs?: number
  /**
   * Cumulative active assistant generation time across provider-stream segments
   * for this assistant turn. Each segment runs from provider-stream start
   * through its terminal generation signal; approval continuations add to the
   * persisted prior total without counting the approval wait. Also excludes
   * request preparation, persistence, analytics, and resource cleanup.
   */
  workDurationMs?: number
  toolMetadataByName?: ToolInvocationMetadataByName
  toolMetadataByCallId?: ToolInvocationMetadataByCallId
}

function titleCaseSegment(value: string): string {
  if (!value) return ""
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function humanizeToolName(name: string): string {
  const normalized = name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()

  if (!normalized) return "Tool"
  return normalized
    .split(/\s+/)
    .map((segment) => titleCaseSegment(segment))
    .join(" ")
}

function toDisplayMetadata(meta: ToolMetadata): ToolInvocationDisplayMetadata {
  return {
    displayName: meta.displayName,
    source: meta.source,
    serviceName: meta.serviceName,
    icon: meta.icon,
    estimatedCostPer1k: meta.estimatedCostPer1k,
    readOnly: meta.readOnly,
    destructive: meta.destructive,
    idempotent: meta.idempotent,
    openWorld: meta.openWorld,
  }
}

function toMcpDisplayMetadata(info: ServerInfo): ToolInvocationDisplayMetadata {
  return {
    displayName: humanizeToolName(info.displayName),
    source: "mcp",
    serviceName: info.serverName,
    icon: "wrench",
    readOnly: info.readOnly,
    destructive: info.destructive,
    idempotent: info.idempotent,
    openWorld: info.openWorld,
  }
}

export function buildToolInvocationMetadataByName(options: {
  nonMcpMetadata: ReadonlyMap<string, ToolMetadata>
  mcpToolServerMap: ReadonlyMap<string, ServerInfo>
}): ToolInvocationMetadataByName {
  const { nonMcpMetadata, mcpToolServerMap } = options
  const byName: ToolInvocationMetadataByName = {}

  for (const [toolName, meta] of nonMcpMetadata) {
    byName[toolName] = toDisplayMetadata(meta)
  }

  for (const [toolName, info] of mcpToolServerMap) {
    byName[toolName] = toMcpDisplayMetadata(info)
  }

  return byName
}

export function buildStartToolInvocationStreamMetadata(
  toolMetadataByName: ToolInvocationMetadataByName
): ToolInvocationStreamMetadata {
  if (Object.keys(toolMetadataByName).length === 0) return {}
  return { toolMetadataByName }
}

export function buildFinishToolInvocationStreamMetadata(options: {
  toolMetadataByCallId: ToolInvocationMetadataByCallId
  reasoningDurationMs: number | null
  workDurationMs: number
}): ToolInvocationStreamMetadata {
  const metadata: ToolInvocationStreamMetadata = {}
  if (Object.keys(options.toolMetadataByCallId).length > 0) {
    metadata.toolMetadataByCallId = options.toolMetadataByCallId
  }
  if (options.reasoningDurationMs !== null) {
    metadata.reasoningDurationMs = options.reasoningDurationMs
  }
  metadata.workDurationMs = options.workDurationMs
  return metadata
}

export function resolveToolInvocationMetadata(options: {
  toolName: string
  toolCallId: string
  streamMetadata?: ToolInvocationStreamMetadata
}): ToolInvocationDisplayMetadata | undefined {
  const byCallId = options.streamMetadata?.toolMetadataByCallId
  if (byCallId?.[options.toolCallId]) {
    return byCallId[options.toolCallId]
  }
  const byName = options.streamMetadata?.toolMetadataByName
  return byName?.[options.toolName]
}
