import { collectChatErrorEvidence } from "./chat-error-evidence"

export type ChatErrorType =
  | "auth"
  | "rate_limit"
  | "provider_api"
  | "tool_timeout"
  | "tool_execution"
  | "validation"
  | "internal"
  | "unknown"

export function getToolDimensionForError(
  errorType: ChatErrorType
): "yes" | "no" {
  return errorType === "tool_timeout" || errorType === "tool_execution"
    ? "yes"
    : "no"
}

function matchesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle))
}

function matchesAnyIn(values: string[], needles: string[]): boolean {
  return values.some((value) => matchesAny(value, needles))
}

function hasStatus(statuses: number[], status: number): boolean {
  return statuses.includes(status)
}

export function classifyChatError(error: unknown): ChatErrorType {
  const { codes, errorTypes, names, messages, statuses } =
    collectChatErrorEvidence(error)
  const hasValidationEvidence =
    hasStatus(statuses, 400) ||
    matchesAnyIn(codes, ["invalid_request", "bad_request", "validation"])
  const hasAuthEvidence =
    hasStatus(statuses, 401) ||
    hasStatus(statuses, 403) ||
    matchesAnyIn(codes, [
      "not_authenticated",
      "unauthorized",
      "forbidden",
      "missing_api_key",
    ])
  const hasRateLimitEvidence =
    hasStatus(statuses, 429) ||
    matchesAnyIn(codes, ["rate_limit", "too_many_requests", "quota_exceeded"])
  const hasPaymentEvidence =
    hasStatus(statuses, 402) ||
    matchesAnyIn(codes, ["payment_required", "insufficient_quota"]) ||
    matchesAnyIn(errorTypes, ["payment_required", "token_limit_exceeded"])

  if (hasValidationEvidence) return "validation"
  if (hasAuthEvidence) return "auth"
  if (hasRateLimitEvidence) return "rate_limit"
  if (hasPaymentEvidence) return "provider_api"

  const toolSignals =
    matchesAnyIn(codes, ["tool"]) ||
    matchesAnyIn(messages, ["tool", "mcp", "function call", "tool_call"])
  if (
    toolSignals &&
    (matchesAnyIn(names, ["timeout"]) ||
      matchesAnyIn(codes, ["timeout"]) ||
      matchesAnyIn(messages, [
        "timeout",
        "timed out",
        "deadline exceeded",
        "aborterror",
      ]))
  ) {
    return "tool_timeout"
  }

  if (
    matchesAnyIn(messages, [
      "missing required",
      "invalid request",
      "validation",
      "guest id required",
    ])
  ) {
    return "validation"
  }

  if (
    matchesAnyIn(messages, [
      "rate limit",
      "too many requests",
      "quota exceeded",
    ])
  ) {
    return "rate_limit"
  }

  if (
    matchesAnyIn(messages, [
      "payment required",
      "requires payment",
      "insufficient credit",
      "insufficient quota",
    ])
  ) {
    return "provider_api"
  }

  if (
    matchesAnyIn(messages, [
      "not authenticated",
      "requires authentication",
      "api key",
      "unauthorized",
      "forbidden",
    ])
  ) {
    return "auth"
  }

  if (toolSignals) {
    return "tool_execution"
  }

  if (
    hasStatus(statuses, 502) ||
    hasStatus(statuses, 503) ||
    hasStatus(statuses, 504) ||
    matchesAnyIn(codes, ["provider", "upstream"]) ||
    matchesAnyIn(messages, [
      "openai",
      "anthropic",
      "google",
      "xai",
      "mistral",
      "perplexity",
      "openrouter",
      "upstream",
      "provider",
      "model not found",
    ])
  ) {
    return "provider_api"
  }

  if (statuses.some((status) => status >= 500)) {
    return "internal"
  }

  return "unknown"
}
