import type { ToolErrorCode } from "./errors"

/**
 * Provider tools keep SDK names, third-party tools use `{action}_{resource}`,
 * and MCP tools are namespaced automatically as `{serverName}_{toolName}`.
 */
export type ToolSource = "builtin" | "third-party" | "mcp" | "platform"

/** Metadata used for tool presentation, policy, audit logging, and cost. */
export type ToolMetadata = {
  displayName: string
  source: ToolSource
  serviceName: string
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
 *   1. Created by the Chat turn runtime before streamText()
 *   2. The shared execution policy records traces during execute()
 *   3. The Tool runtime's onStepFinish reads traces at step end and the
 *      outcome sinks project them into Convex, PostHog, and trace logs
 *   4. Garbage collected when the request ends
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

/**
 * Per-capability model tool access. Omitted fields default to enabled;
 * `tools: false` on a model disables every capability.
 */
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

/** Resolve the model's boolean or granular tool policy with enabled defaults. */
export function resolveToolCapabilities(
  tools: boolean | ToolCapabilities | undefined
): Required<ToolCapabilities> {
  if (tools === false)
    return {
      search: false,
      extract: false,
      code: false,
      mcp: false,
      platform: false,
    }
  if (tools === true || tools === undefined)
    return {
      search: true,
      extract: true,
      code: true,
      mcp: true,
      platform: true,
    }
  return {
    search: tools.search !== false,
    extract: tools.extract !== false,
    code: tools.code !== false,
    mcp: tools.mcp !== false,
    platform: tools.platform !== false,
  }
}
