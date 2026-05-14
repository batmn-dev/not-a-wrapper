// lib/tools/types.ts

import type { ToolErrorCode } from "./errors"

/**
 * Tool Naming Convention
 *
 * Layer 1 (provider): Use the SDK-defined name (e.g., `web_search` from
 * `openai.tools.webSearch()`). These names are controlled by the provider
 * SDK and should not be renamed.
 *
 * Layer 2 (third-party): Use `{action}_{resource}` format.
 * Current: `web_search` (Exa), `extract_content` (Exa).
 * When the third provider is added, consider migrating to `{service}_{action}`
 * format (e.g., `exa_search`, `exa_extract`) to disambiguate providers.
 *
 * Layer 3 (MCP): Namespaced automatically by the MCP client as
 * `{serverName}_{toolName}`. No manual naming needed.
 *
 * Layer 4 (platform): Previously used for platform-level integrations.
 * Currently empty after removal of experimental features.
 */

/**
 * Source identifier for tool audit logging and UI display.
 * - "builtin": Provider-specific tools (OpenAI web search, Google grounding, etc.)
 * - "third-party": Third-party tools via API keys (Exa, Firecrawl, etc.)
 * - "mcp": User-configured MCP server tools (existing system)
 */
export type ToolSource = "builtin" | "third-party" | "mcp" | "platform"

/**
 * Metadata for a tool, used for UI display, audit logging, and cost tracking.
 */
export type ToolMetadata = {
  /** Human-readable display name (e.g., "Web Search", "Exa Search") */
  displayName: string
  /** Tool source layer */
  source: ToolSource
  /** Provider or service name (e.g., "OpenAI", "Exa", "my-mcp-server") */
  serviceName: string
  /** Optional icon identifier for the UI */
  icon?: "search" | "code" | "image" | "extract" | "wrench"
  /**
   * Estimated cost per 1,000 invocations in USD.
   * Used for BYOK cost transparency in the UI — shown in tool invocation cards.
   * Omit if the tool has no marginal cost or cost is unknown.
   */
  estimatedCostPer1k?: number
  /**
   * Maximum result size in bytes for this specific tool.
   * Overrides the global MAX_TOOL_RESULT_SIZE when set.
   * Use for tools that legitimately need larger results (e.g., code execution: 500KB).
   */
  maxResultSize?: number
  /**
   * Whether this tool is read-only (no side effects).
   * Used by prepareStep to restrict tools after initial steps.
   * Default: true for search tools, false for write tools.
   */
  readOnly?: boolean
  /**
   * Whether this tool performs destructive updates (delete, overwrite).
   * Mapped from MCP `destructiveHint` annotation when available.
   * Used for future approval UI and prepareStep restrictions.
   */
  destructive?: boolean
  /**
   * Whether calling this tool multiple times with the same input is safe.
   * Mapped from MCP `idempotentHint` annotation when available.
   * Used for future retry policies (only retry idempotent tools).
   */
  idempotent?: boolean
  /**
   * Whether this tool interacts with an open-world context
   * (arbitrary internet/external systems).
   * Mapped from MCP `openWorldHint` annotation when available.
   * Used by centralized capability/risk policy decisions.
   */
  openWorld?: boolean
}

/**
 * @deprecated No longer used for model-facing tool results.
 *
 * All tool layers now return raw data to the model. Observability
 * metadata (durationMs, source, tool name) is emitted via structured
 * console.log with `_tag: "tool_exec"` or recorded in ToolTraceCollector.
 *
 * On error, tools throw so the AI SDK sets isError: true — this
 * preserves correct success detection in onFinish, PostHog events,
 * and audit logs.
 *
 * Retained for type reference in tests only. Do NOT use in new code.
 */
export type ToolResultEnvelope<T = unknown> = {
  ok: boolean
  data: T | null
  error: string | null
  meta: {
    tool: string
    source: string
    durationMs: number
    [key: string]: unknown
  }
}

/**
 * Granular per-capability control for model tool access.
 * Replaces the binary `tools?: boolean` in ModelConfig.
 *
 * All fields default to `true` when omitted — preserves backward
 * compatibility with existing `tools: undefined` (all tools enabled).
 *
 * When `tools: false` on a ModelConfig, ALL capabilities are disabled.
 * When `tools: ToolCapabilities`, individual capabilities can be toggled.
 */
// ── Trace Types ────────────────────────────────────────────

export type ToolTrace = {
  toolName: string
  toolCallId: string
  requestId?: string
  durationMs: number
  success: boolean
  error?: string
  resultSizeBytes?: number
  errorCode?: ToolErrorCode
  retryAfterSeconds?: number
  budgetKeyMode?: "platform" | "byok"
  budgetDenied?: boolean
  retryCount?: number
}

/**
 * Collects per-tool-call traces for a single streamText() request.
 * Created before streamText(), read in onStepFinish and onFinish.
 *
 * Lifecycle:
 *   1. Created in route.ts before streamText()
 *   2. wrapMcpTools() / wrapToolsWithTracing() record traces during execute()
 *   3. onStepFinish reads traces for structured logging
 *   4. onFinish reads traces for Convex + PostHog enrichment
 *   5. Garbage collected when the request ends
 */
export class ToolTraceCollector {
  private traces = new Map<string, ToolTrace>()

  record(trace: ToolTrace): void {
    this.traces.set(trace.toolCallId, trace)
  }

  get(toolCallId: string): ToolTrace | undefined {
    return this.traces.get(toolCallId)
  }

  getAll(): ToolTrace[] {
    return Array.from(this.traces.values())
  }
}

// ── Tool Capabilities ─────────────────────────────────────

export type ToolCapabilities = {
  /** Web search (Layer 1 provider tools + Layer 2 Exa). Default: true */
  search?: boolean
  /** Content extraction from URLs (Layer 2 Exa getContents). Default: true */
  extract?: boolean
  /** Code execution (provider sandboxes, future). Default: true */
  code?: boolean
  /** MCP server tools (Layer 3). Default: true */
  mcp?: boolean
  /** App-owned tools (Layer 4). Default: true */
  platform?: boolean
}

/**
 * Resolve a ModelConfig.tools value into individual capability flags.
 * Handles the boolean → ToolCapabilities migration.
 *
 * @param tools - The raw tools value from ModelConfig
 * @returns Resolved capabilities (all default to true)
 */
export function resolveToolCapabilities(
  tools: boolean | ToolCapabilities | undefined
): Required<ToolCapabilities> {
  if (tools === false) return { search: false, extract: false, code: false, mcp: false, platform: false }
  if (tools === true || tools === undefined) return { search: true, extract: true, code: true, mcp: true, platform: true }
  return {
    search: tools.search !== false,
    extract: tools.extract !== false,
    code: tools.code !== false,
    mcp: tools.mcp !== false,
    platform: tools.platform !== false,
  }
}
