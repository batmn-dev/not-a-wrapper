import "server-only"
import { scrubForAnalytics } from "@/lib/posthog/scrub"
import * as ai from "ai"
import {
  flush,
  initLogger,
  setMaskingFunction,
  traced,
  wrapAISDK,
  type Span,
} from "braintrust"

const DEFAULT_PROJECT_NAME = "not-a-wrapper"
const REDACTED = "[REDACTED]"
const MAX_MASK_DEPTH = 20

const FALSEY_ENV_VALUES = new Set(["0", "false", "off", "no"])

const SENSITIVE_KEY_RE =
  /(?:^|[_-])(?:api[_-]?key|authorization|bearer|byok|clerk|convex|cookie|credentials?|encryptedkey|id[_-]?token|password|refresh[_-]?token|secret|session|set[_-]?cookie|token)(?:$|[_-])/i
const SECRET_VALUE_RE =
  /\b(?:Bearer\s+)?(?:bt|gh[pousr]|sk|xox[baprs]?)-[A-Za-z0-9_-]{8,}\b/g

const UNSAFE_IDENTIFIER_KEYS = new Set([
  "authuserid",
  "chatid",
  "clientuserid",
  "conversationid",
  "distinctid",
  "message_group_id",
  "messagegroupid",
  "userid",
])

const AI_CONTENT_KEYS = new Set([
  "arguments",
  "args",
  "content",
  "input",
  "message",
  "messages",
  "output",
  "prompt",
  "response",
  "result",
  "system",
  "text",
  "toolcalls",
  "tool_calls",
  "toolresults",
  "tool_results",
])

export type BraintrustMetadataValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | BraintrustMetadataValue[]
  | { [key: string]: BraintrustMetadataValue }

export type BraintrustChatMetadata = Record<string, BraintrustMetadataValue>
export type BraintrustTraceSpan = Span | null

type BraintrustTraceOptions = {
  name: string
  metadata: BraintrustChatMetadata
  onError?: (span: Span, error: unknown) => void
}

let braintrustInitialized = false
let wrappedAISDK: typeof ai | null = null

function normalizeEnvFlag(value: string | undefined): string | undefined {
  return value?.trim().toLowerCase()
}

export function isBraintrustEnabled(): boolean {
  const enabledFlag = normalizeEnvFlag(process.env.BRAINTRUST_ENABLED)
  if (enabledFlag && FALSEY_ENV_VALUES.has(enabledFlag)) return false
  return Boolean(process.env.BRAINTRUST_API_KEY)
}

export function shouldLogBraintrustContent(): boolean {
  return normalizeEnvFlag(process.env.BRAINTRUST_LOG_CONTENT) === "true"
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_RE.test(key)
}

function isAIContentKey(key: string): boolean {
  return AI_CONTENT_KEYS.has(key.toLowerCase())
}

function isUnsafeIdentifierKey(key: string): boolean {
  return UNSAFE_IDENTIFIER_KEYS.has(key.toLowerCase())
}

function scrubBraintrustString(value: string): string {
  return scrubForAnalytics(value).replace(SECRET_VALUE_RE, REDACTED)
}

function redactSensitiveKeys(value: unknown, depth = 0): unknown {
  if (depth > MAX_MASK_DEPTH) return REDACTED
  if (value === null || value === undefined) return value
  if (typeof value === "string") return scrubBraintrustString(value)
  if (typeof value === "number" || typeof value === "boolean") return value
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveKeys(item, depth + 1))
  }
  if (typeof value !== "object") return REDACTED

  const result: Record<string, unknown> = {}
  for (const [key, childValue] of Object.entries(
    value as Record<string, unknown>
  )) {
    result[key] = isSensitiveKey(key) || isUnsafeIdentifierKey(key)
      ? REDACTED
      : redactSensitiveKeys(childValue, depth + 1)
  }
  return result
}

function maskBraintrustValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_MASK_DEPTH) return REDACTED
  if (value === null || value === undefined) return value
  if (typeof value === "string") return scrubBraintrustString(value)
  if (typeof value === "number" || typeof value === "boolean") return value
  if (Array.isArray(value)) {
    return value.map((item) => maskBraintrustValue(item, depth + 1))
  }
  if (typeof value !== "object") return REDACTED

  const result: Record<string, unknown> = {}
  for (const [key, childValue] of Object.entries(
    value as Record<string, unknown>
  )) {
    if (isSensitiveKey(key) || isUnsafeIdentifierKey(key)) {
      result[key] = REDACTED
      continue
    }
    if (isAIContentKey(key)) {
      result[key] = shouldLogBraintrustContent()
        ? scrubForAnalytics(redactSensitiveKeys(childValue))
        : REDACTED
      continue
    }
    result[key] = maskBraintrustValue(childValue, depth + 1)
  }
  return result
}

export function maskBraintrustPayload(value: unknown): unknown {
  if (shouldLogBraintrustContent()) {
    return scrubForAnalytics(redactSensitiveKeys(value))
  }
  return maskBraintrustValue(value)
}

function sanitizeMetadataValue(
  value: unknown,
  depth = 0
): BraintrustMetadataValue {
  if (depth > MAX_MASK_DEPTH) return REDACTED
  if (value === null || value === undefined) return value
  if (typeof value === "string") return scrubBraintrustString(value)
  if (typeof value === "number" || typeof value === "boolean") return value
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeMetadataValue(item, depth + 1))
  }
  if (typeof value !== "object") return REDACTED

  const result: BraintrustChatMetadata = {}
  for (const [key, childValue] of Object.entries(
    value as Record<string, unknown>
  )) {
    result[key] =
      isSensitiveKey(key) || isUnsafeIdentifierKey(key) || isAIContentKey(key)
        ? REDACTED
        : sanitizeMetadataValue(childValue, depth + 1)
  }
  return result
}

export function sanitizeBraintrustMetadata(
  metadata: BraintrustChatMetadata
): BraintrustChatMetadata {
  return sanitizeMetadataValue(metadata) as BraintrustChatMetadata
}

function initializeBraintrust(): boolean {
  if (!isBraintrustEnabled()) return false
  if (braintrustInitialized) return true

  try {
    setMaskingFunction(maskBraintrustPayload)
    initLogger({
      projectName: process.env.BRAINTRUST_PROJECT_NAME || DEFAULT_PROJECT_NAME,
      apiKey: process.env.BRAINTRUST_API_KEY,
      appUrl: process.env.BRAINTRUST_API_URL || undefined,
      asyncFlush: true,
      setCurrent: true,
      debugLogLevel: false,
      onFlushError: () => {
        console.warn("[Braintrust] Flush failed; trace data may be incomplete.")
      },
    })
    wrappedAISDK = wrapAISDK(ai)
    braintrustInitialized = true
    return true
  } catch {
    console.warn("[Braintrust] Initialization failed; tracing is disabled.")
    return false
  }
}

export function getBraintrustStreamText(): typeof ai.streamText {
  if (!initializeBraintrust()) return ai.streamText
  return (wrappedAISDK ?? ai).streamText
}

export function withBraintrustTrace<T>(
  options: BraintrustTraceOptions,
  callback: (span: BraintrustTraceSpan) => T
): T {
  if (!initializeBraintrust()) return callback(null)

  const metadata = sanitizeBraintrustMetadata(options.metadata)
  return traced(
    (span) => {
      try {
        return callback(span)
      } catch (error) {
        options.onError?.(span, error)
        throw error
      }
    },
    {
      name: options.name,
      type: "function",
      event: { metadata },
      asyncFlush: true,
    }
  )
}

export function logBraintrustTraceMetadata(
  span: Span | null,
  metadata: BraintrustChatMetadata
): void {
  if (!span) return
  span.log({ metadata: sanitizeBraintrustMetadata(metadata) })
}

export function getBraintrustErrorMetadata(
  error: unknown
): BraintrustChatMetadata {
  const maybeRecord = error as {
    name?: unknown
    code?: unknown
    status?: unknown
    statusCode?: unknown
    message?: unknown
  }
  return sanitizeBraintrustMetadata({
    errorName: typeof maybeRecord?.name === "string" ? maybeRecord.name : null,
    errorCode: typeof maybeRecord?.code === "string" ? maybeRecord.code : null,
    errorStatus:
      typeof maybeRecord?.status === "number" ? maybeRecord.status : null,
    errorStatusCode:
      typeof maybeRecord?.statusCode === "number"
        ? maybeRecord.statusCode
        : null,
    errorMessage:
      typeof maybeRecord?.message === "string" ? maybeRecord.message : null,
  })
}

export async function flushBraintrust(): Promise<void> {
  if (!braintrustInitialized) return
  try {
    await flush()
  } catch {
    console.warn("[Braintrust] Flush failed; trace data may be incomplete.")
  }
}

export async function hashBraintrustIdentifier(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest("SHA-256", encoded)
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
  return `sha256:${hex.slice(0, 32)}`
}
