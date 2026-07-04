// lib/tools/utils.ts

import { MAX_TOOL_RESULT_SIZE, TOOL_EXECUTION_TIMEOUT_MS } from "@/lib/config"
import type { ToolSet } from "ai"
import {
  extractToolErrorData,
  getToolRecoveryHint,
  normalizeToolError,
  ToolExecutionError,
  type ToolErrorCode,
  type ToolErrorData,
} from "./errors"
import { extractPolicyErrorData, isToolPolicyError } from "./policy"
import {
  findSemanticBoundary,
  resolveTruncationStrategy,
  scoreArrayItem,
  type TruncationCategory,
  type TruncationContext,
} from "./truncation-policy"
import { ToolTraceCollector, type ToolMetadata } from "./types"

type ToolExecuteOptions = {
  toolCallId: string
  abortSignal?: AbortSignal
  [k: string]: unknown
}

type RetrySafetyMetadata = Pick<
  ToolMetadata,
  "idempotent" | "readOnly" | "destructive"
>

type RetryAttemptInfo = {
  attempt: number
  maxAttempts: number
  delayMs: number
  error: ToolErrorData
}

const RETRYABLE_TRANSIENT_CODES: ToolErrorCode[] = [
  "timeout",
  "rate_limit",
  "network",
  "upstream_failure",
]

/**
 * Thrown when a tool execution exceeds its timeout.
 */
export class ToolTimeoutError extends Error {
  readonly toolName: string
  readonly timeoutMs: number

  constructor(toolName: string, timeoutMs: number) {
    super(
      `Tool "${toolName}" timed out after ${timeoutMs}ms. ` +
        `The operation was taking too long and was cancelled.`
    )
    this.name = "ToolTimeoutError"
    this.toolName = toolName
    this.timeoutMs = timeoutMs
  }
}

/**
 * Thrown when tool execution is cancelled by upstream abort.
 */
export class ToolAbortError extends Error {
  readonly toolName: string

  constructor(toolName: string, reason?: unknown) {
    const reasonText =
      typeof reason === "string" && reason.length > 0
        ? ` Reason: ${reason}`
        : ""
    super(`Tool "${toolName}" was cancelled by upstream caller.${reasonText}`)
    this.name = "ToolAbortError"
    this.toolName = toolName
  }
}

export function extractAbortSignalFromOptions(
  options: unknown
): AbortSignal | undefined {
  if (typeof options !== "object" || options === null) return undefined
  const withAbort = options as { abortSignal?: unknown }
  const candidate = withAbort.abortSignal
  if (
    typeof candidate === "object" &&
    candidate !== null &&
    "aborted" in candidate &&
    typeof (candidate as AbortSignal).aborted === "boolean" &&
    "addEventListener" in candidate
  ) {
    return candidate as AbortSignal
  }
  return undefined
}

export function combineAbortSignals(
  signals: Array<AbortSignal | undefined>
): AbortSignal | undefined {
  const active = signals.filter((signal): signal is AbortSignal => !!signal)
  if (active.length === 0) return undefined
  if (active.length === 1) return active[0]

  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any(active)
  }

  const controller = new AbortController()
  for (const signal of active) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      break
    }
  }
  if (!controller.signal.aborted) {
    const listeners: Array<{
      signal: AbortSignal
      handler: () => void
    }> = []
    const cleanupListeners = () => {
      for (const { signal, handler } of listeners) {
        signal.removeEventListener("abort", handler)
      }
      listeners.length = 0
    }

    for (const signal of active) {
      const onAbort = () => {
        cleanupListeners()
        if (!controller.signal.aborted) {
          controller.abort(signal.reason)
        }
      }
      listeners.push({ signal, handler: onAbort })
      signal.addEventListener("abort", onAbort, { once: true })
    }
  }
  return controller.signal
}

function toCancellationError(
  toolName: string,
  timeoutMs: number,
  timeoutSignal: AbortSignal,
  upstreamSignal?: AbortSignal
): ToolTimeoutError | ToolAbortError {
  if (timeoutSignal.aborted) return new ToolTimeoutError(toolName, timeoutMs)
  return new ToolAbortError(toolName, upstreamSignal?.reason)
}

export function throwIfAborted(
  signal: AbortSignal | undefined,
  options: {
    toolName: string
    timeoutMs?: number
    timeoutSignal?: AbortSignal
    upstreamSignal?: AbortSignal
  }
): void {
  if (!signal?.aborted) return
  if (options.timeoutSignal && typeof options.timeoutMs === "number") {
    throw toCancellationError(
      options.toolName,
      options.timeoutMs,
      options.timeoutSignal,
      options.upstreamSignal
    )
  }
  throw new ToolAbortError(options.toolName, options.upstreamSignal?.reason)
}

export async function runWithToolAbortAndTimeout<T>(options: {
  toolName: string
  timeoutMs: number
  upstreamSignal?: AbortSignal
  operation: (combinedSignal: AbortSignal) => Promise<T>
}): Promise<T> {
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs)
  const combinedSignal =
    combineAbortSignals([options.upstreamSignal, timeoutSignal]) ??
    timeoutSignal

  throwIfAborted(combinedSignal, {
    toolName: options.toolName,
    timeoutMs: options.timeoutMs,
    timeoutSignal,
    upstreamSignal: options.upstreamSignal,
  })

  let onAbort: (() => void) | undefined
  const abortPromise = new Promise<never>((_, reject) => {
    onAbort = () =>
      reject(
        toCancellationError(
          options.toolName,
          options.timeoutMs,
          timeoutSignal,
          options.upstreamSignal
        )
      )
    combinedSignal.addEventListener("abort", onAbort, { once: true })
  })

  try {
    return await Promise.race([options.operation(combinedSignal), abortPromise])
  } finally {
    if (onAbort) combinedSignal.removeEventListener("abort", onAbort)
  }
}

function isRetrySafeTool(metadata?: RetrySafetyMetadata): boolean {
  if (!metadata) return false
  if (metadata.idempotent === true) return true
  // Read-only tools are safe to replay in this stack. Side-effectful tools
  // should always set readOnly: false.
  return metadata.readOnly === true && metadata.destructive !== true
}

function isTransientRetryableError(error: ToolErrorData): boolean {
  if (error.code === "policy_limit") return false
  if (error.code === "auth") return false
  if (error.code === "validation_input") return false
  if (error.code === "aborted") return false

  if (!RETRYABLE_TRANSIENT_CODES.includes(error.code)) return false
  return true
}

function computeRetryDelayMs(options: {
  attempt: number
  retryAfterSeconds?: number
  baseDelayMs: number
  maxDelayMs: number
  jitterRatio: number
}): number {
  const base = Math.min(
    options.maxDelayMs,
    options.baseDelayMs * 2 ** (options.attempt - 1)
  )
  const jitterCap = Math.max(0, Math.floor(base * options.jitterRatio))
  const jitter = jitterCap > 0 ? Math.floor(Math.random() * (jitterCap + 1)) : 0
  const backoffWithJitter = Math.min(options.maxDelayMs, base + jitter)
  const retryAfterMs = (options.retryAfterSeconds ?? 0) * 1000
  return Math.max(backoffWithJitter, retryAfterMs)
}

async function sleepWithAbort(
  delayMs: number,
  signal: AbortSignal | undefined,
  toolName: string
): Promise<void> {
  if (delayMs <= 0) return
  throwIfAborted(signal, { toolName, upstreamSignal: signal })

  await new Promise<void>((resolve, reject) => {
    let onAbort: (() => void) | undefined
    const timer = setTimeout(() => {
      if (onAbort && signal) signal.removeEventListener("abort", onAbort)
      resolve()
    }, delayMs)

    if (signal) {
      onAbort = () => {
        clearTimeout(timer)
        signal.removeEventListener("abort", onAbort!)
        reject(new ToolAbortError(toolName, signal.reason))
      }
      signal.addEventListener("abort", onAbort, { once: true })
    }
  })
}

export async function executeWithRetries<T>(options: {
  toolName: string
  metadata?: RetrySafetyMetadata
  maxAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  jitterRatio?: number
  abortSignal?: AbortSignal
  execute: (attempt: number) => Promise<T>
  onRetryAttempt?: (info: RetryAttemptInfo) => void
}): Promise<{ value: T; retryCount: number }> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3)
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 200)
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 2000)
  const jitterRatio = Math.min(Math.max(options.jitterRatio ?? 0.25, 0), 1)
  const retrySafe = isRetrySafeTool(options.metadata)

  let attempt = 1
  while (true) {
    try {
      const value = await options.execute(attempt)
      return { value, retryCount: attempt - 1 }
    } catch (err) {
      const normalized = extractToolErrorData(err, {
        toolName: options.toolName,
      })
      const shouldRetry =
        retrySafe &&
        attempt < maxAttempts &&
        isTransientRetryableError(normalized)

      if (!shouldRetry) throw err

      const delayMs = computeRetryDelayMs({
        attempt,
        retryAfterSeconds: normalized.retryAfterSeconds,
        baseDelayMs,
        maxDelayMs,
        jitterRatio,
      })

      options.onRetryAttempt?.({
        attempt,
        maxAttempts,
        delayMs,
        error: normalized,
      })

      await sleepWithAbort(delayMs, options.abortSignal, options.toolName)
      attempt++
    }
  }
}

const TEXT_ENCODER = new TextEncoder()

type JsonSafeValue =
  | string
  | number
  | boolean
  | null
  | JsonSafeValue[]
  | { [key: string]: JsonSafeValue }

function normalizeNonSerializableLeaf(value: unknown): JsonSafeValue {
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "function") {
    return `[Function ${value.name || "anonymous"}]`
  }
  if (typeof value === "symbol") return value.toString()
  if (typeof value === "undefined") return "[undefined]"
  return String(value)
}

/**
 * Convert unknown data into a deterministic JSON-safe value.
 * Preserves structure where possible while replacing unsupported values
 * (cycles, bigint, symbol, function, undefined) with stable markers.
 */
export function sanitizeForJson(value: unknown): JsonSafeValue {
  try {
    const seen = new WeakSet<object>()
    const serialized = JSON.stringify(value, (_key, currentValue) => {
      if (typeof currentValue === "bigint") {
        return currentValue.toString()
      }
      if (typeof currentValue === "function") {
        return `[Function ${currentValue.name || "anonymous"}]`
      }
      if (typeof currentValue === "symbol") {
        return currentValue.toString()
      }
      if (typeof currentValue === "undefined") {
        return "[undefined]"
      }
      if (typeof currentValue === "object" && currentValue !== null) {
        if (seen.has(currentValue)) return "[Circular]"
        seen.add(currentValue)
      }
      return currentValue
    })

    if (serialized === undefined) {
      return normalizeNonSerializableLeaf(value)
    }

    return JSON.parse(serialized) as JsonSafeValue
  } catch {
    return normalizeNonSerializableLeaf(value)
  }
}

export type TruncateToolResultOptions = {
  maxBytes?: number
  toolName?: string
  resultCategory?: TruncationCategory
}

function serializedSizeBytes(value: unknown): number {
  return TEXT_ENCODER.encode(safeStringify(value)).length
}

function enforceFinalSerializedBudget(
  value: unknown,
  maxBytes: number,
  fallbackHint: string
): unknown {
  if (serializedSizeBytes(value) <= maxBytes) return value

  const minimal = {
    _truncated: true,
    _hint:
      compactTruncationHint(fallbackHint, Math.floor(maxBytes * 0.8)) ||
      "Result truncated.",
  }
  if (serializedSizeBytes(minimal) <= maxBytes) return minimal
  return { _truncated: true }
}

function trimStringToSerializedBudget(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return ""
  if (serializedSizeBytes(text) <= maxBytes) return text
  let low = 0
  let high = text.length
  let best = ""
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidate = text.slice(0, mid)
    if (serializedSizeBytes(candidate) <= maxBytes) {
      best = candidate
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return best
}

function compactTruncationHint(hint: string, maxBytes: number): string {
  if (serializedSizeBytes(hint) <= maxBytes) return hint
  return trimStringToSerializedBudget(hint, maxBytes)
}

function resolveTruncateOptions(
  maxBytesOrOptions: number | TruncateToolResultOptions | undefined
): Required<Pick<TruncateToolResultOptions, "maxBytes">> & TruncationContext {
  if (typeof maxBytesOrOptions === "number") {
    return { maxBytes: maxBytesOrOptions }
  }
  return {
    maxBytes: maxBytesOrOptions?.maxBytes ?? MAX_TOOL_RESULT_SIZE,
    toolName: maxBytesOrOptions?.toolName,
    resultCategory: maxBytesOrOptions?.resultCategory,
  }
}

function scoreObjectKey(
  key: string,
  originalIndex: number,
  strategy: ReturnType<typeof resolveTruncationStrategy>
): number {
  const lower = key.toLowerCase()
  const priorityIndex = strategy.keyPriority.findIndex(
    (candidate) => candidate.toLowerCase() === lower
  )
  if (priorityIndex >= 0) {
    return 2_000 - priorityIndex * 25 - originalIndex * 0.001
  }
  if (lower.includes("error")) return 1_800 - originalIndex * 0.001
  if (lower.includes("title")) return 1_700 - originalIndex * 0.001
  if (lower.includes("url")) return 1_650 - originalIndex * 0.001
  if (lower.includes("content")) return 1_600 - originalIndex * 0.001
  if (lower.includes("summary") || lower.includes("snippet")) {
    return 1_550 - originalIndex * 0.001
  }
  return 1_000 - originalIndex * 0.001
}

function truncateLongString(
  text: string,
  maxBytes: number,
  strategy: ReturnType<typeof resolveTruncationStrategy>
): string {
  const semanticTarget = Math.max(1, Math.floor(maxBytes * 0.65))
  const semanticCut = findSemanticBoundary(text, semanticTarget)
  const suffixHint = strategy.stringHint

  const buildVerboseSuffix = (shownChars: number) =>
    `\n[truncated — showing first ${shownChars} of ${text.length} chars. ${suffixHint}]`
  const buildCompactSuffix = (shownChars: number) =>
    `\n[truncated — showing first ${shownChars} of ${text.length} chars.]`

  const initialCut = Math.max(1, semanticCut)
  let prefix = text.slice(0, initialCut)
  let suffix = buildVerboseSuffix(prefix.length)
  let candidate = `${prefix}${suffix}`

  if (serializedSizeBytes(candidate) <= maxBytes) {
    return candidate
  }

  // Fit content first, preserving semantic boundary attempt, then fallback to
  // exact byte-safe clipping via binary search.
  prefix = trimStringToSerializedBudget(prefix, Math.floor(maxBytes * 0.75))
  suffix = buildCompactSuffix(prefix.length)
  candidate = `${prefix}${suffix}`
  if (serializedSizeBytes(candidate) <= maxBytes) {
    return candidate
  }

  let low = 0
  let high = prefix.length
  let best = ""
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const currentPrefix = prefix.slice(0, mid)
    const currentCandidate = `${currentPrefix}${buildCompactSuffix(currentPrefix.length)}`
    if (serializedSizeBytes(currentCandidate) <= maxBytes) {
      best = currentCandidate
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  if (best) return best
  const clippedSuffix = compactTruncationHint(buildCompactSuffix(0), maxBytes)
  if (clippedSuffix) return clippedSuffix
  return trimStringToSerializedBudget("[truncated]", maxBytes)
}

function truncateOversizedArray(
  items: unknown[],
  options: {
    maxBytes: number
    originalSizeBytes: number
    strategy: ReturnType<typeof resolveTruncationStrategy>
  }
): Record<string, unknown> {
  const sanitizedItems = items.map((item) => sanitizeForJson(item))
  const selectedIndexes: number[] = []
  const rankedIndexes = items
    .map((item, index) => ({
      index,
      score: scoreArrayItem(item, index, options.strategy),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)

  const buildEnvelope = (data: unknown[], hint: string) => ({
    _truncated: true,
    _originalCount: items.length,
    _returnedCount: data.length,
    _originalSizeBytes: options.originalSizeBytes,
    _hint: hint,
    data,
  })

  const hint = `Result was truncated from ${items.length} items. ${options.strategy.arrayHint}`

  for (const candidate of rankedIndexes) {
    const nextIndexes = [...selectedIndexes, candidate.index].sort(
      (a, b) => a - b
    )
    const nextData = nextIndexes.map((index) => sanitizedItems[index])
    const nextEnvelope = buildEnvelope(nextData, hint)
    if (serializedSizeBytes(nextEnvelope) <= options.maxBytes) {
      selectedIndexes.splice(0, selectedIndexes.length, ...nextIndexes)
    }
  }

  const data = selectedIndexes.map((index) => sanitizedItems[index])
  const envelope = buildEnvelope(data, hint)

  if (serializedSizeBytes(envelope) <= options.maxBytes) {
    return envelope
  }

  // Last-resort byte-safe minimal array envelope.
  const minimalHint = compactTruncationHint(
    `Result truncated. ${options.strategy.arrayHint}`,
    Math.floor(options.maxBytes * 0.7)
  )
  const minimal = buildEnvelope([], minimalHint || "Result truncated.")
  if (serializedSizeBytes(minimal) <= options.maxBytes) return minimal

  return {
    _truncated: true,
    _originalCount: items.length,
    _returnedCount: 0,
    data: [],
  }
}

function truncateOversizedObject(
  value: Record<string, unknown>,
  options: {
    maxBytes: number
    originalSizeBytes: number
    strategy: ReturnType<typeof resolveTruncationStrategy>
  }
): Record<string, unknown> {
  const reservedMetadataKeys = new Set([
    "_hint",
    "_truncated",
    "_originalSizeBytes",
    "_keptKeys",
  ])
  const entries = Object.entries(value)
  const ranked = entries
    .map(([key, entryValue], index) => ({
      key,
      entryValue: sanitizeForJson(entryValue),
      index,
      score: scoreObjectKey(key, index, options.strategy),
    }))
    .filter((entry) => !reservedMetadataKeys.has(entry.key))
    .sort((a, b) => b.score - a.score || a.index - b.index)

  const output: Record<string, unknown> = {
    _truncated: true,
    _originalSizeBytes: options.originalSizeBytes,
    _hint: `Object was truncated. ${options.strategy.objectHint}`,
  }

  let keptKeys = 0
  for (const entry of ranked) {
    output[entry.key] = entry.entryValue
    if (serializedSizeBytes(output) <= options.maxBytes) {
      keptKeys++
      continue
    }
    delete output[entry.key]
  }
  output._keptKeys = keptKeys

  if (serializedSizeBytes(output) <= options.maxBytes) {
    return output
  }

  // Remove kept key counter first to preserve user-facing guidance.
  delete output._keptKeys
  if (serializedSizeBytes(output) <= options.maxBytes) {
    return output
  }

  output._hint = compactTruncationHint(
    "Object truncated. Request specific fields.",
    Math.floor(options.maxBytes * 0.7)
  )
  if (serializedSizeBytes(output) <= options.maxBytes) {
    return output
  }

  return {
    _truncated: true,
    _hint: "Object truncated.",
  }
}

/**
 * Truncate a tool result to a maximum byte size.
 * Applied as a safety net AFTER the tool's own execute() returns.
 *
 * Design decisions:
 * - Shape-preserving: arrays remain arrays in `data`, objects preserve keys
 * - Model-informed: includes `_truncated` markers with concise recovery hints
 * - Strategy-driven: default policy + optional per-tool/per-category overrides
 * - Hard budget safety: final payload is always clipped to maxBytes
 */
export function truncateToolResult(
  result: unknown,
  maxBytesOrOptions: number | TruncateToolResultOptions = MAX_TOOL_RESULT_SIZE
): unknown {
  const options = resolveTruncateOptions(maxBytesOrOptions)
  const maxBytes = Math.max(1, options.maxBytes)
  const strategy = resolveTruncationStrategy({
    toolName: options.toolName,
    resultCategory: options.resultCategory,
  })

  const originalSizeBytes = serializedSizeBytes(result)
  if (originalSizeBytes <= maxBytes) return result

  console.warn(
    `[tools] Result truncated: ${originalSizeBytes} bytes → ${maxBytes} bytes limit` +
      (options.toolName ? ` (tool: ${options.toolName})` : "")
  )
  const finalize = (value: unknown, fallbackHint: string) =>
    enforceFinalSerializedBudget(value, maxBytes, fallbackHint)

  if (typeof result === "string") {
    const truncated = truncateLongString(result, maxBytes, strategy)
    return finalize(truncated, "Result truncated.")
  }

  if (Array.isArray(result)) {
    const truncated = truncateOversizedArray(result, {
      maxBytes,
      originalSizeBytes,
      strategy,
    })
    return finalize(truncated, "Result truncated.")
  }

  if (typeof result === "object" && result !== null) {
    const truncated = truncateOversizedObject(
      result as Record<string, unknown>,
      {
        maxBytes,
        originalSizeBytes,
        strategy,
      }
    )
    return finalize(truncated, "Object truncated.")
  }

  const clipped = trimStringToSerializedBudget(String(result), maxBytes)
  return finalize(clipped, "Result truncated.")
}

/**
 * Check if a tool result was truncated by truncateToolResult().
 */
export function isTruncated(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    "_truncated" in result &&
    (result as Record<string, unknown>)._truncated === true
  )
}

/**
 * Wrap all tools in a ToolSet with result truncation.
 * Used for tool sources that don't manage their own result sizes
 * (e.g., MCP tools from user-configured servers).
 *
 * Layer 1 tools are exempt (provider-managed limits).
 * Layer 2 tools apply truncation inside their execute() directly.
 */
export function wrapToolsWithTruncation(
  tools: ToolSet,
  maxBytes: number = MAX_TOOL_RESULT_SIZE
): ToolSet {
  const wrapped: Record<string, unknown> = {}
  for (const [name, t] of Object.entries(tools)) {
    const original = t as Record<string, unknown>
    if (typeof original.execute === "function") {
      const origExec = original.execute as (
        ...args: unknown[]
      ) => Promise<unknown>
      wrapped[name] = {
        ...original,
        execute: async (...args: unknown[]) => {
          const result = await origExec(...args)
          return truncateToolResult(result, {
            maxBytes,
            toolName: name,
          })
        },
      }
    } else {
      wrapped[name] = original
    }
  }
  return wrapped as ToolSet
}

/**
 * Wrap all tools in a ToolSet with timing + trace recording.
 * Records start/end time around each execute() call and writes
 * the trace to the shared ToolTraceCollector so the step-end
 * outcome recording can read durationMs for ALL tool types.
 *
 * Structural twin of wrapToolsWithTruncation — same iteration
 * and casting pattern. Applied SEPARATELY (not composed) because
 * truncation is an MCP-only concern while tracing applies to
 * Layer 2 (third-party) and Layer 4 (platform) tools.
 */
export function wrapToolsWithTracing(
  tools: ToolSet,
  traceCollector: ToolTraceCollector,
  requestId?: string,
  enforceToolBudget?: (toolName: string) => Promise<void>,
  metadataByToolName?: ReadonlyMap<string, RetrySafetyMetadata>
): ToolSet {
  const wrapped: Record<string, unknown> = {}
  for (const [name, t] of Object.entries(tools)) {
    const original = t as Record<string, unknown>
    if (typeof original.execute === "function") {
      const origExec = original.execute as (
        params: unknown,
        options: { toolCallId: string; [k: string]: unknown }
      ) => Promise<unknown>

      wrapped[name] = {
        ...original,
        execute: async (
          params: unknown,
          options: ToolExecuteOptions
        ): Promise<unknown> => {
          const startMs = Date.now()
          const upstreamAbortSignal = extractAbortSignalFromOptions(options)
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

            const { value: result, retryCount: retries } =
              await executeWithRetries({
                toolName: name,
                metadata: metadataByToolName?.get(name),
                abortSignal: upstreamAbortSignal,
                execute: async () =>
                  runWithToolAbortAndTimeout({
                    toolName: name,
                    timeoutMs: TOOL_EXECUTION_TIMEOUT_MS,
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
                      attempt: attempt.attempt,
                      maxAttempts: attempt.maxAttempts,
                      delayMs: attempt.delayMs,
                      errorCode: attempt.error.code,
                    })
                  )
                },
              })
            retryCount = retries

            try {
              const serialized = JSON.stringify(result)
              resultSizeBytes = new TextEncoder().encode(serialized).length
            } catch {
              // Non-serializable — skip measurement
            }

            return result
          } catch (err) {
            success = false
            error = err instanceof Error ? err.message : String(err)
            const errorData = extractToolErrorData(err, { toolName: name })
            errorCode = errorData.code
            retryAfterSeconds = errorData.retryAfterSeconds

            const policyData = extractPolicyErrorData(err)
            if (policyData) {
              budgetKeyMode = policyData.keyMode
              budgetDenied = policyData.budgetDenied
            }
            throw err
          } finally {
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
    } else {
      wrapped[name] = original
    }
  }
  return wrapped as ToolSet
}

/**
 * Enrich a tool error with actionable recovery hints for the model.
 * The AI SDK passes thrown error messages to the model as tool results.
 * Adding recovery guidance helps the model self-correct instead of
 * retrying the same failing operation.
 *
 * @param err - The original error
 * @param toolName - The tool that failed (for context in the message)
 * @returns A new Error with the original message plus a recovery hint
 */
export function enrichToolError(err: unknown, toolName: string): Error {
  if (isToolPolicyError(err)) return err
  if (
    err instanceof Error &&
    (err.name === "ToolTimeoutError" || err.name === "ToolAbortError")
  ) {
    return err
  }
  if (err instanceof ToolExecutionError) return err

  const normalized = normalizeToolError(err, { toolName })
  const hint = getToolRecoveryHint(normalized)
  const enriched = new ToolExecutionError(
    `${toolName} failed: ${normalized.message}. ${hint}`,
    {
      code: normalized.code,
      retryable: normalized.retryable,
      retryAfterSeconds: normalized.retryAfterSeconds,
      statusCode: normalized.statusCode,
      toolName: normalized.toolName ?? toolName,
      details: normalized.details,
    }
  )
  if (err instanceof Error && err.stack) enriched.stack = err.stack
  return enriched
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(sanitizeForJson(value))
  } catch {
    return String(value)
  }
}
