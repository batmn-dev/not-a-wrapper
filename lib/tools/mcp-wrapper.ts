import {
  MAX_TOOL_RESULT_SIZE,
  MCP_CIRCUIT_BREAKER_THRESHOLD,
  MCP_TOOL_EXECUTION_TIMEOUT_MS,
} from "@/lib/config"
import type { ServerInfo } from "@/lib/mcp/load-tools"
import type { ToolSet } from "ai"
import type { ToolErrorCode } from "./errors"
import { wrapToolsWithExecutionPolicy } from "./execution-policy"
import { ToolTraceCollector } from "./types"
import type { ToolTrace } from "./types"
import { enrichToolError, ToolTimeoutError, truncateToolResult } from "./utils"

// Compatibility exports for existing consumers.
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

type WrapMcpToolsConfig = {
  toolServerMap: Map<string, ServerInfo>
  traceCollector: ToolTraceCollector
  requestId?: string
  timeoutMs?: number
  maxResultBytes?: number
  enforceToolBudget?: (toolName: string) => Promise<void>
}

/**
 * Wrap MCP tools with timeout, timing, truncation, and envelope.
 *
 * Failures remain thrown so the AI SDK records tool errors correctly; successful
 * results are enveloped and truncated.
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

  return wrapToolsWithExecutionPolicy(tools, {
    traceCollector,
    requestId,
    enforceToolBudget,
    resolveAdapter: (name) => {
      const serverInfo = toolServerMap.get(name)
      const displayName = serverInfo?.displayName ?? name
      // MCP annotation hints are advisory by default. Automatic retries are only
      // enabled when the request context explicitly trusts the server AND the
      // safety signal is clear (explicit idempotent + explicit non-destructive).
      const hasExplicitNonDestructiveSignal =
        serverInfo?.destructive === false || serverInfo?.readOnly === true
      const retryMetadata =
        serverInfo?.retrySafetyTrusted === true &&
        serverInfo?.idempotent === true &&
        hasExplicitNonDestructiveSignal
          ? {
              idempotent: true,
              readOnly: serverInfo?.readOnly,
              destructive: serverInfo?.destructive,
            }
          : undefined

      // Keep circuit state isolated when server metadata is missing.
      const circuitKey = serverInfo?.serverId ?? `tool:${name}`

      return {
        errorToolName: displayName,
        timeoutMs,
        retrySafety: retryMetadata,
        retryLogContext: {
          source: "mcp",
          server: serverInfo?.serverName ?? "unknown",
        },
        preflight: () => {
          const failures = serverFailureCounts.get(circuitKey) ?? 0
          if (failures >= circuitThreshold) {
            throw enrichToolError(
              new Error(
                `Server "${serverInfo?.serverName ?? displayName}" circuit open — ${failures} consecutive transient tool failures in this request`
              ),
              displayName
            )
          }
        },
        transformResult: (result) =>
          truncateToolResult(result, {
            maxBytes: maxResultBytes,
            toolName: name,
          }),
        onSuccess: () => {
          serverFailureCounts.delete(circuitKey)
        },
        onFailure: (facts) => {
          if (isTransientCircuitFailure(facts.errorCode)) {
            serverFailureCounts.set(
              circuitKey,
              (serverFailureCounts.get(circuitKey) ?? 0) + 1
            )
          } else {
            serverFailureCounts.delete(circuitKey)
          }
          console.error(
            `[tools/mcp] ${displayName} failed after ${facts.durationMs}ms:`,
            facts.errorMessage
          )
        },
        transformError: (error) => enrichToolError(error, displayName),
      }
    },
  })
}
