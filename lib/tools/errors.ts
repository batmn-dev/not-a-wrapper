import { extractPolicyErrorData, type ToolPolicyCode } from "./policy"

export type ToolErrorCode =
  | "aborted"
  | "timeout"
  | "rate_limit"
  | "auth"
  | "network"
  | "validation_input"
  | "policy_limit"
  | "upstream_failure"
  | "unknown"

export type ToolExecutionErrorDetails = Record<string, unknown>

export type ToolExecutionErrorOptions = {
  code: ToolErrorCode
  retryable: boolean
  retryAfterSeconds?: number
  statusCode?: number
  toolName?: string
  details?: ToolExecutionErrorDetails
}

export class ToolExecutionError extends Error {
  readonly code: ToolErrorCode
  readonly retryable: boolean
  readonly retryAfterSeconds?: number
  readonly statusCode?: number
  readonly toolName?: string
  readonly details?: ToolExecutionErrorDetails

  constructor(message: string, options: ToolExecutionErrorOptions) {
    super(message)
    this.name = "ToolExecutionError"
    this.code = options.code
    this.retryable = options.retryable
    this.retryAfterSeconds = options.retryAfterSeconds
    this.statusCode = options.statusCode
    this.toolName = options.toolName
    this.details = options.details
  }
}

export type ToolErrorData = {
  code: ToolErrorCode
  retryable: boolean
  retryAfterSeconds?: number
  statusCode?: number
  toolName?: string
  details?: ToolExecutionErrorDetails
}

function toError(err: unknown): Error {
  if (err instanceof Error) return err
  return new Error(String(err))
}

function extractStatusCode(err: Error): number | undefined {
  const maybeStatusCode = (err as Error & { statusCode?: unknown }).statusCode
  if (typeof maybeStatusCode === "number") return maybeStatusCode

  const maybeStatus = (err as Error & { status?: unknown }).status
  if (typeof maybeStatus === "number") return maybeStatus

  const match = err.message.match(/\b(4\d{2}|5\d{2})\b/)
  if (!match) return undefined

  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : undefined
}

function extractRetryAfterSeconds(err: Error): number | undefined {
  const retryAfterProp = (err as Error & { retryAfterSeconds?: unknown })
    .retryAfterSeconds
  if (typeof retryAfterProp === "number" && Number.isFinite(retryAfterProp)) {
    return retryAfterProp
  }

  const match = err.message.match(
    /retry after(?: approximately)?\s+(\d+)\s*seconds?/i
  )
  if (!match) return undefined

  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : undefined
}

function isTimeoutLike(err: Error): boolean {
  return (
    err.name === "ToolTimeoutError" ||
    /\btime(?:d)?\s*out\b/i.test(err.message) ||
    /\btimeout\b/i.test(err.message)
  )
}

function isAbortedLike(err: Error): boolean {
  return (
    err.name === "AbortError" ||
    err.name === "ToolAbortError" ||
    /\baborted\b/i.test(err.message) ||
    /\bcancel(?:ed|led)\b/i.test(err.message)
  )
}

function isRateLimitLike(err: Error, statusCode?: number): boolean {
  if (statusCode === 429) return true
  return (
    /\brate limit\b/i.test(err.message) ||
    /\brate limited\b/i.test(err.message) ||
    /\btoo many requests\b/i.test(err.message) ||
    /\b429\b/.test(err.message)
  )
}

function isAuthLike(err: Error, statusCode?: number): boolean {
  if (statusCode === 401 || statusCode === 403) return true
  return (
    /\bunauthorized\b/i.test(err.message) ||
    /\bforbidden\b/i.test(err.message) ||
    /\binvalid api key\b/i.test(err.message) ||
    /\bexpired api key\b/i.test(err.message)
  )
}

function isNetworkLike(err: Error): boolean {
  return (
    /\bECONNREFUSED\b/.test(err.message) ||
    /\bENOTFOUND\b/.test(err.message) ||
    /\bEAI_AGAIN\b/.test(err.message) ||
    /\bfetch failed\b/i.test(err.message) ||
    /\bnetwork\b/i.test(err.message)
  )
}

function isValidationLike(err: Error, statusCode?: number): boolean {
  if (statusCode === 400 || statusCode === 422) return true
  return (
    /\bvalidation\b/i.test(err.message) ||
    /\binvalid input\b/i.test(err.message) ||
    /\binput invalid\b/i.test(err.message) ||
    /\bmissing required\b/i.test(err.message) ||
    /\bschema\b/i.test(err.message)
  )
}

function mapPolicyErrorDetails(
  policyCode: ToolPolicyCode
): ToolExecutionErrorDetails {
  return { policyCode }
}

export function normalizeToolError(
  err: unknown,
  options: { toolName?: string } = {}
): ToolExecutionError {
  if (err instanceof ToolExecutionError) return err

  const policyData = extractPolicyErrorData(err)
  if (policyData) {
    return new ToolExecutionError(
      err instanceof Error ? err.message : "Tool policy limit reached.",
      {
        code: "policy_limit",
        retryable: true,
        retryAfterSeconds: policyData.retryAfterSeconds,
        toolName: options.toolName,
        details: {
          ...mapPolicyErrorDetails(policyData.code),
          keyMode: policyData.keyMode,
          scopeKey: policyData.scopeKey,
          budgetDenied: policyData.budgetDenied,
        },
      }
    )
  }

  const original = toError(err)
  const statusCode = extractStatusCode(original)
  const retryAfterSeconds = extractRetryAfterSeconds(original)

  let code: ToolErrorCode = "unknown"
  let retryable = false

  if (isTimeoutLike(original)) {
    code = "timeout"
    retryable = true
  } else if (isAbortedLike(original)) {
    code = "aborted"
    retryable = false
  } else if (isRateLimitLike(original, statusCode)) {
    code = "rate_limit"
    retryable = true
  } else if (isAuthLike(original, statusCode)) {
    code = "auth"
    retryable = false
  } else if (isNetworkLike(original)) {
    code = "network"
    retryable = true
  } else if (isValidationLike(original, statusCode)) {
    code = "validation_input"
    retryable = false
  } else if (typeof statusCode === "number" && statusCode >= 500) {
    code = "upstream_failure"
    retryable = true
  }

  const normalized = new ToolExecutionError(original.message, {
    code,
    retryable,
    retryAfterSeconds,
    statusCode,
    toolName: options.toolName,
    details: { originalName: original.name },
  })

  if (original.stack) normalized.stack = original.stack
  return normalized
}

export function extractToolErrorData(
  err: unknown,
  options: { toolName?: string } = {}
): ToolErrorData {
  const normalized = normalizeToolError(err, options)
  return {
    code: normalized.code,
    retryable: normalized.retryable,
    retryAfterSeconds: normalized.retryAfterSeconds,
    statusCode: normalized.statusCode,
    toolName: normalized.toolName,
    details: normalized.details,
  }
}

export function getToolRecoveryHint(data: ToolErrorData): string {
  switch (data.code) {
    case "aborted":
      return "Tool execution was cancelled. Continue without this tool result."
    case "timeout":
      return "Try a shorter or more specific query, or skip this step."
    case "rate_limit":
      return data.retryAfterSeconds
        ? `Rate limit exceeded. Retry after about ${data.retryAfterSeconds} seconds.`
        : "Rate limit exceeded. Wait before trying again or use a different approach."
    case "auth":
      return "Authentication failed. Inform the user to verify or refresh their API key."
    case "network":
      return "Network error. The service may be temporarily unavailable; try again or skip this step."
    case "validation_input":
      return "Tool input is invalid. Adjust the arguments and retry with a more specific request."
    case "policy_limit":
      return data.retryAfterSeconds
        ? `Tool policy limit reached. Retry after about ${data.retryAfterSeconds} seconds.`
        : "Tool policy limit reached. Retry later with fewer tool calls."
    case "upstream_failure":
      return "Upstream service failed. Retry later or use an alternate approach."
    case "unknown":
    default:
      return "If the error persists, try a different approach or skip this step."
  }
}
