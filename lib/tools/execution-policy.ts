import { TOOL_EXECUTION_TIMEOUT_MS } from "@/lib/config"
import type { ToolSet } from "ai"
import { extractToolErrorData, type ToolErrorCode } from "./errors"
import { extractPolicyErrorData } from "./policy"
import { ToolTraceCollector } from "./types"
import {
  executeWithRetries,
  extractAbortSignalFromOptions,
  runWithToolAbortAndTimeout,
  type RetrySafetyMetadata,
} from "./utils"

type ToolExecuteOptions = {
  toolCallId: string
  abortSignal?: AbortSignal
  [key: string]: unknown
}

type ToolExecutionFailureFacts = {
  durationMs: number
  errorMessage: string
  errorCode: ToolErrorCode
  stage: "preflight" | "execution"
  retryAfterSeconds?: number
}

type ToolExecutionAdapter = {
  errorToolName?: string
  timeoutMs?: number
  retrySafety?: RetrySafetyMetadata
  retryLogContext?: Record<string, unknown>
  preflight?: () => void
  transformResult?: (result: unknown) => unknown
  onSuccess?: () => void
  onFailure?: (facts: ToolExecutionFailureFacts) => void
  transformError?: (error: unknown) => unknown
}

type WrapToolsWithExecutionPolicyConfig = {
  traceCollector: ToolTraceCollector
  requestId?: string
  enforceToolBudget?: (toolName: string) => Promise<void>
  resolveAdapter?: (toolName: string) => ToolExecutionAdapter
}

/** Apply the request-local execution contract to every locally executed tool. */
export function wrapToolsWithExecutionPolicy(
  tools: ToolSet,
  config: WrapToolsWithExecutionPolicyConfig
): ToolSet {
  const wrapped: Record<string, unknown> = {}

  for (const [toolName, tool] of Object.entries(tools)) {
    const original = tool as Record<string, unknown>
    if (typeof original.execute !== "function") {
      wrapped[toolName] = original
      continue
    }

    const execute = original.execute as (
      input: unknown,
      options: ToolExecuteOptions
    ) => unknown
    const adapter = config.resolveAdapter?.(toolName) ?? {}
    const errorToolName = adapter.errorToolName ?? toolName

    wrapped[toolName] = {
      ...original,
      execute: async (input: unknown, options: ToolExecuteOptions) => {
        const startMs = Date.now()
        const upstreamAbortSignal = extractAbortSignalFromOptions(options)
        let stage: ToolExecutionFailureFacts["stage"] = "preflight"
        let success = true
        let error: string | undefined
        let resultSizeBytes: number | undefined
        let errorCode: ToolErrorCode | undefined
        let retryAfterSeconds: number | undefined
        let budgetKeyMode: "platform" | "byok" | undefined
        let budgetDenied: boolean | undefined
        let retryCount = 0

        try {
          adapter.preflight?.()
          stage = "execution"
          await config.enforceToolBudget?.(toolName)

          const execution = await executeWithRetries({
            toolName,
            metadata: adapter.retrySafety,
            abortSignal: upstreamAbortSignal,
            execute: () =>
              runWithToolAbortAndTimeout({
                toolName,
                timeoutMs: adapter.timeoutMs ?? TOOL_EXECUTION_TIMEOUT_MS,
                upstreamSignal: upstreamAbortSignal,
                operation: (abortSignal) =>
                  Promise.resolve(execute(input, { ...options, abortSignal })),
              }),
            onRetryAttempt: (attempt) => {
              console.warn(
                JSON.stringify({
                  _tag: "tool_retry",
                  requestId: config.requestId,
                  tool: toolName,
                  ...adapter.retryLogContext,
                  attempt: attempt.attempt,
                  maxAttempts: attempt.maxAttempts,
                  delayMs: attempt.delayMs,
                  errorCode: attempt.error.code,
                })
              )
            },
          })
          retryCount = execution.retryCount

          try {
            resultSizeBytes = new TextEncoder().encode(
              JSON.stringify(execution.value)
            ).length
          } catch {
            // Non-serializable results remain valid Tool outputs.
          }

          const result = adapter.transformResult
            ? adapter.transformResult(execution.value)
            : execution.value
          adapter.onSuccess?.()
          return result
        } catch (caught) {
          success = false
          error = caught instanceof Error ? caught.message : String(caught)
          const errorData = extractToolErrorData(caught, {
            toolName: errorToolName,
          })
          errorCode = errorData.code
          retryAfterSeconds = errorData.retryAfterSeconds

          const policyData = extractPolicyErrorData(caught)
          if (policyData) {
            budgetKeyMode = policyData.keyMode
            budgetDenied = policyData.budgetDenied
          }

          adapter.onFailure?.({
            durationMs: Date.now() - startMs,
            errorMessage: error,
            errorCode,
            stage,
            retryAfterSeconds,
          })
          throw adapter.transformError ? adapter.transformError(caught) : caught
        } finally {
          config.traceCollector.record({
            toolName,
            toolCallId: options.toolCallId,
            requestId: config.requestId,
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
