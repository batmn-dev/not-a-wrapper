import type { Provider } from "@/lib/provider-ids"
import type { ApiKeySource } from "@/lib/user-keys"

export type PublicChatErrorCode =
  | "AUTHENTICATION_ERROR"
  | "PAYMENT_REQUIRED"
  | "RATE_LIMIT_EXCEEDED"
  | "PROVIDER_ERROR"
  | "UNKNOWN_ERROR"

export type PublicChatErrorContext = {
  provider?: Provider
  credentialSource?: ApiKeySource
}

export type PublicChatError = {
  code: PublicChatErrorCode
  message: string
  retryable: boolean
  provider?: Provider
  credentialSource?: ApiKeySource
}

type ErrorRecord = {
  statusCode?: unknown
  status?: unknown
  code?: unknown
  message?: unknown
  responseBody?: unknown
  error?: unknown
  cause?: unknown
  lastError?: unknown
  errors?: unknown
}

const PROVIDER_NAMES: Record<Provider, string> = {
  openai: "OpenAI",
  mistral: "Mistral",
  perplexity: "Perplexity",
  google: "Google",
  anthropic: "Anthropic",
  xai: "xAI",
  openrouter: "OpenRouter",
}

function asRecord(value: unknown): ErrorRecord | null {
  return value && typeof value === "object" ? (value as ErrorRecord) : null
}

function collectErrorChain(error: unknown): ErrorRecord[] {
  const queue: Array<{ value: unknown; depth: number }> = [
    { value: error, depth: 0 },
  ]
  const seen = new Set<object>()
  const records: ErrorRecord[] = []

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue

    const record = asRecord(current.value)
    if (!record || seen.has(record as object)) continue
    seen.add(record as object)
    records.push(record)

    if (current.depth >= 4) continue
    for (const nested of [record.error, record.cause, record.lastError]) {
      if (nested && typeof nested === "object") {
        queue.push({ value: nested, depth: current.depth + 1 })
      }
    }
    if (Array.isArray(record.errors)) {
      for (const nested of record.errors) {
        if (nested && typeof nested === "object") {
          queue.push({ value: nested, depth: current.depth + 1 })
        }
      }
    }
  }

  return records
}

function parseStatus(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string") return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

function extractResponseBodyMessage(responseBody: unknown): string | null {
  if (typeof responseBody !== "string" || responseBody.length === 0) return null
  try {
    const parsed = JSON.parse(responseBody) as {
      error?: { message?: unknown } | string
      message?: unknown
    }
    if (typeof parsed.error === "object" && parsed.error) {
      return typeof parsed.error.message === "string"
        ? parsed.error.message
        : null
    }
    if (typeof parsed.error === "string") return parsed.error
    return typeof parsed.message === "string" ? parsed.message : null
  } catch {
    return null
  }
}

function includesAny(values: string[], needles: string[]): boolean {
  return values.some((value) =>
    needles.some((needle) => value.includes(needle))
  )
}

function providerName(provider?: Provider): string | undefined {
  return provider ? PROVIDER_NAMES[provider] : undefined
}

function paymentMessage(context: PublicChatErrorContext): string {
  const name = providerName(context.provider)
  if (!name) return "Insufficient credits or payment required."
  if (context.credentialSource === "byok") {
    return `Your ${name} API account has insufficient credits or requires payment. Check ${name} billing or update your API key in settings.`
  }
  if (context.credentialSource === "platform") {
    return `${name} is temporarily unavailable because the app's provider account requires payment. Try again later or add your own ${name} API key in settings.`
  }
  return `Insufficient credits or payment required for ${name}.`
}

function authenticationMessage(context: PublicChatErrorContext): string {
  const name = providerName(context.provider)
  if (!name) return "Invalid API key or authentication failed."
  if (context.credentialSource === "byok") {
    return `Your ${name} API key was rejected. Update it in settings.`
  }
  if (context.credentialSource === "platform") {
    return `${name} authentication is temporarily unavailable. Try again later or add your own ${name} API key in settings.`
  }
  return `Invalid API key or authentication failed for ${name}.`
}

function rateLimitMessage(context: PublicChatErrorContext): string {
  const name = providerName(context.provider)
  return name
    ? `${name} rate limit exceeded. Please try again later.`
    : "Rate limit exceeded. Please try again later."
}

/**
 * Convert an arbitrary provider/AI SDK error into the one public result used by
 * the stream, durable persistence, analytics, and UI. Provider attribution is
 * accepted only from the already-resolved runtime context; raw messages and
 * stacks are never treated as routing facts.
 */
export function normalizeChatError(
  error: unknown,
  context: PublicChatErrorContext = {}
): PublicChatError {
  const records = collectErrorChain(error)
  const statuses = records
    .flatMap((record) => [
      parseStatus(record.statusCode),
      parseStatus(record.status),
    ])
    .filter((status): status is number => status !== undefined)
  const codes = records
    .map((record) =>
      typeof record.code === "string" ? record.code.toLowerCase() : ""
    )
    .filter(Boolean)
  const messages = records
    .flatMap((record) => [
      typeof record.message === "string" ? record.message : "",
      extractResponseBodyMessage(record.responseBody) ?? "",
    ])
    .filter(Boolean)
  if (typeof error === "string" && error.length > 0) messages.unshift(error)
  const normalizedMessages = messages.map((message) => message.toLowerCase())
  const rootError = records[0]
  const internalMissingApiKeyMessage =
    rootError?.code === "MISSING_API_KEY" &&
    [
      rootError.statusCode,
      rootError.status,
    ].some((status) => parseStatus(status) === 401) &&
    typeof rootError.message === "string" &&
    rootError.message.length > 0
      ? rootError.message
      : null
  const base = {
    ...(context.provider ? { provider: context.provider } : {}),
    ...(context.credentialSource
      ? { credentialSource: context.credentialSource }
      : {}),
  }

  if (codes.includes("missing_api_key")) {
    return {
      ...base,
      code: "AUTHENTICATION_ERROR",
      message: internalMissingApiKeyMessage ?? authenticationMessage(context),
      retryable: false,
    }
  }

  if (
    statuses.includes(401) ||
    includesAny(codes, ["authentication", "unauthorized", "invalid_api_key"]) ||
    includesAny(normalizedMessages, [
      "invalid x-api-key",
      "authentication_error",
      "incorrect api key",
      "invalid api key",
    ])
  ) {
    return {
      ...base,
      code: "AUTHENTICATION_ERROR",
      message: authenticationMessage(context),
      retryable: false,
    }
  }

  if (
    statuses.includes(402) ||
    includesAny(codes, ["payment_required", "insufficient_quota"]) ||
    includesAny(normalizedMessages, [
      "payment required",
      "insufficient credit",
      "insufficient quota",
      "billing",
      "credits",
    ])
  ) {
    return {
      ...base,
      code: "PAYMENT_REQUIRED",
      message: paymentMessage(context),
      retryable: false,
    }
  }

  if (
    statuses.includes(429) ||
    includesAny(codes, ["rate_limit", "too_many_requests"]) ||
    includesAny(normalizedMessages, ["rate limit", "too many requests"])
  ) {
    return {
      ...base,
      code: "RATE_LIMIT_EXCEEDED",
      message: rateLimitMessage(context),
      retryable: true,
    }
  }

  const fallbackMessage = messages[0]
  if (fallbackMessage) {
    return {
      ...base,
      code: "PROVIDER_ERROR",
      message: "An error occurred. Please try again.",
      retryable: true,
    }
  }

  return {
    ...base,
    code: "UNKNOWN_ERROR",
    message: "An error occurred. Please try again.",
    retryable: true,
  }
}
