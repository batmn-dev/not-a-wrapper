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
  const { codes, names, messages, statuses } = collectChatErrorEvidence(error)

  if (
    hasStatus(statuses, 400) ||
    matchesAnyIn(codes, ["invalid_request", "bad_request", "validation"]) ||
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
    hasStatus(statuses, 401) ||
    hasStatus(statuses, 403) ||
    matchesAnyIn(codes, [
      "not_authenticated",
      "unauthorized",
      "forbidden",
      "missing_api_key",
    ]) ||
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

  if (
    hasStatus(statuses, 429) ||
    matchesAnyIn(codes, [
      "rate_limit",
      "too_many_requests",
      "quota_exceeded",
    ]) ||
    matchesAnyIn(messages, [
      "rate limit",
      "too many requests",
      "quota exceeded",
    ])
  ) {
    return "rate_limit"
  }

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
  if (toolSignals) {
    return "tool_execution"
  }

  if (
    hasStatus(statuses, 402) ||
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
