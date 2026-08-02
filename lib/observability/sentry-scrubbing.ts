import { redactSecretsInString } from "./secret-patterns"

const REDACTED_VALUE = "[REDACTED]"

// Exception names become Sentry grouping/type data and structured log fields.
// Keep this list explicit: accepting an arbitrary identifier-shaped string
// would still allow a payload or secret consisting of a single token through.
const SAFE_EXCEPTION_NAMES = new Set([
  // JavaScript and browser built-ins.
  "AbortError",
  "AggregateError",
  "DOMException",
  "Error",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",

  // Application-owned errors that can reach the chat telemetry boundary.
  "DurableWorkerWriteError",
  "FileUploadLimitError",
  "McpUrlValidationError",
  "ModelBoundReplayInvariantError",
  "PublicChatHttpError",
  "ToolAbortError",
  "ToolExecutionError",
  "ToolPolicyError",
  "ToolTimeoutError",
  "UsageLimitError",
  "WorkerWriteTimeoutError",

  // Error types exposed by the currently installed AI SDK packages.
  "AI_APICallError",
  "AI_DownloadError",
  "AI_EmptyResponseBodyError",
  "AI_InvalidArgumentError",
  "AI_InvalidDataContentError",
  "AI_InvalidMessageRoleError",
  "AI_InvalidPromptError",
  "AI_InvalidResponseDataError",
  "AI_InvalidStreamPartError",
  "AI_InvalidToolApprovalError",
  "AI_InvalidToolApprovalSignatureError",
  "AI_InvalidToolInputError",
  "AI_JSONParseError",
  "AI_LoadAPIKeyError",
  "AI_LoadSettingError",
  "AI_MCPClientError",
  "AI_MCPClientOAuthError",
  "AI_MessageConversionError",
  "AI_MissingToolResultsError",
  "AI_NoContentGeneratedError",
  "AI_NoImageGeneratedError",
  "AI_NoObjectGeneratedError",
  "AI_NoOutputGeneratedError",
  "AI_NoSpeechGeneratedError",
  "AI_NoSuchModelError",
  "AI_NoSuchProviderError",
  "AI_NoSuchProviderReferenceError",
  "AI_NoSuchToolError",
  "AI_NoTranscriptGeneratedError",
  "AI_NoVideoGeneratedError",
  "AI_RetryError",
  "AI_TooManyEmbeddingValuesForCallError",
  "AI_ToolCallNotFoundForApprovalError",
  "AI_ToolCallRepairError",
  "AI_TypeValidationError",
  "AI_UIMessageStreamError",
  "AI_UnsupportedFunctionalityError",
  "AI_UnsupportedModelVersionError",
  "GatewayAuthenticationError",
  "GatewayFailedDependencyError",
  "GatewayForbiddenError",
  "GatewayInternalServerError",
  "GatewayInvalidRequestError",
  "GatewayModelNotFoundError",
  "GatewayRateLimitError",
  "GatewayResponseError",
  "GatewayTimeoutError",
  "ParseError",
  "UnauthorizedError",
])

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

function isExceptionTypePath(path: string[]): boolean {
  return (
    path.length >= 4 &&
    path[0] === "exception" &&
    path[1] === "values" &&
    path[path.length - 1] === "type"
  )
}

function sanitizeExceptionName(name: string): string {
  return SAFE_EXCEPTION_NAMES.has(name) ? name : "Error"
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

  const sanitizedMessage = sanitizeExceptionMessage(error.message)
  const sanitizedName = sanitizeExceptionName(error.name)
  const sanitized = new Error(sanitizedMessage)
  sanitized.name = sanitizedName
  if (typeof error.stack === "string") {
    const stackFrames = error.stack.split("\n").slice(1)
    const stackHeader = sanitizedMessage
      ? `${sanitizedName}: ${sanitizedMessage}`
      : sanitizedName
    sanitized.stack = [stackHeader, ...stackFrames].join("\n")
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
    if (isExceptionValuePath(path)) {
      return sanitizeExceptionMessage(value)
    }
    if (isExceptionTypePath(path)) {
      return sanitizeExceptionName(value)
    }
    return redactSecretsInString(value)
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
