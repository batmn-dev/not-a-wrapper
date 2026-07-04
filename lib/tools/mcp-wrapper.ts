// lib/tools/mcp-wrapper.ts
//
// Unified MCP tool wrapper — handles timing, timeout, truncation, and envelope
// in a single execute() body. Follows the Exa gold standard pattern from
// lib/tools/third-party.ts:82-119.
//
// Replaces wrapToolsWithTruncation(mcpTools) in route.ts:300-302.

import {
  MAX_TOOL_RESULT_SIZE,
  MCP_CIRCUIT_BREAKER_THRESHOLD,
  MCP_TOOL_EXECUTION_TIMEOUT_MS,
} from "@/lib/config"
import type { ServerInfo } from "@/lib/mcp/load-tools"
import type { ToolSet } from "ai"
import { extractToolErrorData, type ToolErrorCode } from "./errors"
import { extractPolicyErrorData } from "./policy"
import { ToolTraceCollector } from "./types"
import type { ToolTrace } from "./types"
import {
  enrichToolError,
  executeWithRetries,
  extractAbortSignalFromOptions,
  runWithToolAbortAndTimeout,
  ToolTimeoutError,
  truncateToolResult,
} from "./utils"

// Re-export trace types for backward compatibility (route.ts imports from here)
export { ToolTraceCollector, type ToolTrace }
export { ToolTimeoutError }

function isTransientCircuitFailure(
  errorCode: ToolErrorCode | undefined
): boolean {
  if (!errorCode) return false
  return (
    errorCode === "timeout" ||
    errorCode === "rate_limit" ||
    errorCode === "network" ||
    errorCode === "upstream_failure"
  )
}

// ── Configuration ──────────────────────────────────────────

type WrapMcpToolsConfig = {
  /** Map of namespaced tool names → server info for display names and audit */
  toolServerMap: Map<string, ServerInfo>
  /** Trace collector — shared with onStepFinish/onFinish in route.ts */
  traceCollector: ToolTraceCollector
  /** Request-scoped correlation ID for grouping tool traces */
  requestId?: string
  /** Per-tool timeout in ms. Default: MCP_TOOL_EXECUTION_TIMEOUT_MS (30s) */
  timeoutMs?: number
  /** Max result size in bytes. Default: MAX_TOOL_RESULT_SIZE (100KB) */
  maxResultBytes?: number
  /** Optional centralized budget enforcement hook */
  enforceToolBudget?: (toolName: string) => Promise<void>
}

// ── Wrapper ────────────────────────────────────────────────

/**
 * Wrap MCP tools with timeout, timing, truncation, and envelope.
 *
 * Follows the Exa gold standard (third-party.ts:82-119):
 * all concerns handled in a single execute() body.
 *
 * Replaces wrapToolsWithTruncation(mcpTools) at route.ts:300-302.
 *
 * Error behavior: throws on failure (does NOT envelope errors).
 * This preserves the AI SDK's isError detection in onFinish for
 * audit logs and PostHog events. The SDK passes the error message
 * to the model as a tool result — the model can still explain
 * "tool X failed" without the app crashing.
 *
 * @param tools - MCP ToolSet from loadUserMcpTools()
 * @param config - Wrapper configuration
 * @returns Wrapped ToolSet with timeout, timing, truncation, envelope
 */
export function wrapMcpTools(
  tools: ToolSet,
  config: WrapMcpToolsConfig
): ToolSet {
  const {
    toolServerMap,
    traceCollector,
    requestId,
    timeoutMs = MCP_TOOL_EXECUTION_TIMEOUT_MS,
    maxResultBytes = MAX_TOOL_RESULT_SIZE,
    enforceToolBudget,
  } = config

  const serverFailureCounts = new Map<string, number>()
  const circuitThreshold = MCP_CIRCUIT_BREAKER_THRESHOLD

  const wrapped: Record<string, unknown> = {}

  for (const [name, t] of Object.entries(tools)) {
    const original = t as Record<string, unknown>

    // Tools without execute (e.g., provider tools with providerExecuted: true)
    // pass through unchanged. This is a safety net — MCP tools should always
    // have execute, but we check to avoid runtime errors.
    if (typeof original.execute !== "function") {
      wrapped[name] = original
      continue
    }

    const origExec = original.execute as (
      params: unknown,
      options: { toolCallId: string; [k: string]: unknown }
    ) => Promise<unknown>

    const serverInfo = toolServerMap.get(name)
    const displayName = serverInfo?.displayName ?? name
    const trustedRetryHints = serverInfo?.retrySafetyTrusted === true
    // MCP annotation hints are advisory by default. Automatic retries are only
    // enabled when the request context explicitly trusts the server AND the
    // safety signal is clear (explicit idempotent + explicit non-destructive).
    const hasExplicitNonDestructiveSignal =
      serverInfo?.destructive === false || serverInfo?.readOnly === true
    const retryMetadata =
      trustedRetryHints &&
      serverInfo?.idempotent === true &&
      hasExplicitNonDestructiveSignal
        ? {
            idempotent: true,
            readOnly: serverInfo?.readOnly,
            destructive: serverInfo?.destructive,
          }
        : undefined

    wrapped[name] = {
      ...original,
      execute: async (
        params: unknown,
        options: { toolCallId: string; [k: string]: unknown }
      ): Promise<unknown> => {
        const upstreamAbortSignal = extractAbortSignalFromOptions(options)
        // Keep circuit state isolated when server metadata is missing.
        const circuitKey = serverInfo?.serverId ?? `tool:${name}`
        const failures = serverFailureCounts.get(circuitKey) ?? 0
        if (failures >= circuitThreshold) {
          throw enrichToolError(
            new Error(
              `Server "${serverInfo?.serverName ?? displayName}" circuit open — ${failures} consecutive transient tool failures in this request`
            ),
            displayName
          )
        }

        const startMs = Date.now()
        let success = true
        let error: string | undefined
        let resultSizeBytes: number | undefined
        let errorCode: ToolErrorCode | undefined
        let retryAfterSeconds: number | undefined
        let budgetKeyMode: "platform" | "byok" | undefined
        let budgetDenied: boolean | undefined
        let retryCount = 0

        try {
          if (enforceToolBudget) {
            await enforceToolBudget(name)
          }

          const { value: rawResult, retryCount: retries } =
            await executeWithRetries({
              toolName: name,
              metadata: retryMetadata,
              abortSignal: upstreamAbortSignal,
              execute: async () =>
                runWithToolAbortAndTimeout({
                  toolName: name,
                  timeoutMs,
                  upstreamSignal: upstreamAbortSignal,
                  operation: (combinedSignal) =>
                    origExec(params, {
                      ...options,
                      abortSignal: combinedSignal,
                    }),
                }),
              onRetryAttempt: (attempt) => {
                console.warn(
                  JSON.stringify({
                    _tag: "tool_retry",
                    requestId,
                    tool: name,
                    source: "mcp",
                    server: serverInfo?.serverName ?? "unknown",
                    attempt: attempt.attempt,
                    maxAttempts: attempt.maxAttempts,
                    delayMs: attempt.delayMs,
                    errorCode: attempt.error.code,
                  })
                )
              },
            })
          retryCount = retries

          // ── Measure result size (for trace, before truncation) ──
          try {
            const serialized = JSON.stringify(rawResult)
            resultSizeBytes = new TextEncoder().encode(serialized).length
          } catch {
            // Non-serializable result — skip measurement, not critical
          }

          // ── Truncation ─────────────────────────────────
          const truncatedResult = truncateToolResult(rawResult, {
            maxBytes: maxResultBytes,
            toolName: name,
          })

          serverFailureCounts.delete(circuitKey)

          return truncatedResult
        } catch (err) {
          success = false
          error = err instanceof Error ? err.message : String(err)
          const errorData = extractToolErrorData(err, { toolName: displayName })
          errorCode = errorData.code
          retryAfterSeconds = errorData.retryAfterSeconds

          const policyData = extractPolicyErrorData(err)
          if (policyData) {
            budgetKeyMode = policyData.keyMode
            budgetDenied = policyData.budgetDenied
          }

          if (isTransientCircuitFailure(errorCode)) {
            serverFailureCounts.set(
              circuitKey,
              (serverFailureCounts.get(circuitKey) ?? 0) + 1
            )
          } else {
            // Circuit breaker tracks consecutive transient failures only.
            serverFailureCounts.delete(circuitKey)
          }

          console.error(
            `[tools/mcp] ${displayName} failed after ${Date.now() - startMs}ms:`,
            error
          )
          throw enrichToolError(err, displayName)
        } finally {
          // ── Trace (always — success or failure) ────────
          traceCollector.record({
            toolName: name,
            toolCallId: options.toolCallId,
            requestId,
            durationMs: Date.now() - startMs,
            success,
            error,
            resultSizeBytes,
            errorCode,
            retryAfterSeconds,
            budgetKeyMode,
            budgetDenied,
            retryCount,
          })
        }
      },
    }
  }

  return wrapped as ToolSet
}
