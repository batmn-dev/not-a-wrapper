import { redactSecretsInString } from "./secret-patterns"

const REDACTED_VALUE = "[REDACTED]"

const AI_SENSITIVE_PATH_PREFIXES = [
  "ai.prompt",
  "ai.prompt.messages",
  "ai.response.text",
  "ai.response.toolcalls",
  "ai.toolcall.args",
  "ai.toolcall.result",
  "gen_ai.request.messages",
  "gen_ai.response.text",
  "gen_ai.tool.call.arguments",
  "gen_ai.tool.call.result",
  "gen_ai.tool.input",
  "gen_ai.tool.output",
]

const SENSITIVE_KEY_PATTERN =
  /(authorization|cookie|set-cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|password|secret|session|bearer|encrypted[-_]?content)/i

type Scrubbable = Record<string, unknown> | unknown[] | null

function normalizePath(path: string[]): string {
  return path.join(".").toLowerCase()
}

function pathHasSensitivePrefix(path: string[]): boolean {
  const normalized = normalizePath(path)
  return AI_SENSITIVE_PATH_PREFIXES.some(
    (prefix) =>
      normalized === prefix ||
      normalized.startsWith(`${prefix}.`) ||
      prefix.startsWith(`${normalized}.`)
  )
}

function shouldRedactField(path: string[], key: string): boolean {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return true
  }

  return pathHasSensitivePrefix([...path, key])
}

function isExceptionValuePath(path: string[]): boolean {
  return (
    path.length >= 4 &&
    path[0] === "exception" &&
    path[1] === "values" &&
    path[path.length - 1] === "value"
  )
}

/**
 * Retain error classification while removing validation payloads and entity
 * ids. AI SDK validation messages append the complete offending value after
 * `: Value:`, which can contain prompts, tool outputs, or encrypted provider
 * content.
 */
export function sanitizeExceptionMessage(message: string): string {
  const withoutValidationPayload = message.split(": Value:")[0] ?? message
  const withoutEntityIds = withoutValidationPayload
    .replace(/\bid:\s*"[^"]*"/gi, "id: [REDACTED]")
    .replace(/\b(?:toolCallId|approvalId)\s*[:=]\s*"[^"]*"/gi, (match) => {
      const separator = match.includes(":") ? ":" : "="
      return `${match.split(separator)[0]}${separator} [REDACTED]`
    })
  return redactSecretsInString(withoutEntityIds).slice(0, 500)
}

export function sanitizeExceptionForTelemetry(error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error(`Non-Error exception (${typeof error})`)
  }

  const sanitized = new Error(sanitizeExceptionMessage(error.message))
  sanitized.name = error.name
  if (typeof error.stack === "string") {
    sanitized.stack = error.stack.replace(
      error.message,
      sanitizeExceptionMessage(error.message)
    )
  }
  return sanitized
}

export function getSanitizedExceptionSummary(error: unknown): {
  errorName: string
  errorMessage: string
} {
  const sanitized = sanitizeExceptionForTelemetry(error)
  return { errorName: sanitized.name, errorMessage: sanitized.message }
}

function scrubValue(
  value: unknown,
  path: string[],
  seen: WeakMap<object, Scrubbable>
): unknown {
  if (value === null || value === undefined) {
    return value
  }

  if (pathHasSensitivePrefix(path)) {
    return REDACTED_VALUE
  }

  if (Array.isArray(value)) {
    const cachedArray = seen.get(value)
    if (cachedArray !== undefined) {
      return cachedArray
    }

    const outputArray: unknown[] = []
    seen.set(value, outputArray)

    for (const [index, item] of value.entries()) {
      outputArray[index] = scrubValue(item, [...path, String(index)], seen)
    }

    return outputArray
  }

  if (typeof value === "string") {
    // Value-level pass: a credential can appear inside an otherwise-innocuous
    // string (e.g. a provider 401 message under `exception.values[].value`),
    // which key-name/path redaction never reaches.
    return isExceptionValuePath(path)
      ? sanitizeExceptionMessage(value)
      : redactSecretsInString(value)
  }

  if (typeof value !== "object") {
    return value
  }

  const cached = seen.get(value)
  if (cached !== undefined) {
    return cached
  }

  const inputRecord = value as Record<string, unknown>
  const outputRecord: Record<string, unknown> = {}
  seen.set(value, outputRecord)

  for (const [key, nestedValue] of Object.entries(inputRecord)) {
    if (shouldRedactField(path, key)) {
      outputRecord[key] = REDACTED_VALUE
      continue
    }

    outputRecord[key] = scrubValue(nestedValue, [...path, key], seen)
  }

  return outputRecord
}

function scrubSentryPayload<T>(payload: T): T {
  if (payload === null || payload === undefined) {
    return payload
  }

  return scrubValue(payload, [], new WeakMap<object, Scrubbable>()) as T
}

export function sentryBeforeSend<T>(event: T): T {
  return scrubSentryPayload(event)
}

export function sentryBeforeSendSpan<T>(span: T): T {
  return scrubSentryPayload(span)
}

export function sentryBeforeBreadcrumb<T>(breadcrumb: T): T {
  return scrubSentryPayload(breadcrumb)
}
