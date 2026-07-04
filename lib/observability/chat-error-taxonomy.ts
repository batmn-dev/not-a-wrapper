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

type ErrorLike = {
  code?: unknown
  statusCode?: unknown
  status?: unknown
  message?: unknown
  name?: unknown
  error?: unknown
  cause?: unknown
}

function toLowerString(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : ""
}

function matchesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle))
}

function getErrorLike(error: unknown): ErrorLike {
  if (error && typeof error === "object") {
    return error as ErrorLike
  }
  return {}
}

function extractStatusCode(err: ErrorLike): number | undefined {
  const candidates = [err.statusCode, err.status]
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate
    }
    if (typeof candidate === "string") {
      const parsed = Number.parseInt(candidate, 10)
      if (Number.isFinite(parsed)) {
        return parsed
      }
    }
  }
  return undefined
}

function collectErrorChain(error: unknown): ErrorLike[] {
  const queue: Array<{ value: unknown; depth: number }> = [
    { value: error, depth: 0 },
  ]
  const seen = new Set<object>()
  const collected: ErrorLike[] = []

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || !current.value || typeof current.value !== "object") {
      continue
    }

    if (seen.has(current.value)) continue
    seen.add(current.value)

    const err = current.value as ErrorLike
    collected.push(err)

    if (current.depth >= 3) continue
    if (err.error && typeof err.error === "object") {
      queue.push({ value: err.error, depth: current.depth + 1 })
    }
    if (err.cause && typeof err.cause === "object") {
      queue.push({ value: err.cause, depth: current.depth + 1 })
    }
  }

  return collected
}

function matchesAnyIn(values: string[], needles: string[]): boolean {
  return values.some((value) => matchesAny(value, needles))
}

function hasStatus(statuses: number[], status: number): boolean {
  return statuses.includes(status)
}

export function classifyChatError(error: unknown): ChatErrorType {
  const chain = collectErrorChain(error)
  const fallback = getErrorLike(error)
  if (chain.length === 0) chain.push(fallback)

  const codes = chain.map((err) => toLowerString(err.code)).filter(Boolean)
  const names = chain.map((err) => toLowerString(err.name)).filter(Boolean)
  const messages = chain
    .map((err) => toLowerString(err.message))
    .filter(Boolean)
  const statuses = chain
    .map((err) => extractStatusCode(err))
    .filter((status): status is number => typeof status === "number")

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
