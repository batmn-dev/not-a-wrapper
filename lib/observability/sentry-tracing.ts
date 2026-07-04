const CHAT_ROUTE_PATTERN = "/api/chat"
const CHAT_CRITICAL_ROUTE_PATTERNS = [
  CHAT_ROUTE_PATTERN,
  "/api/user-preferences/favorite-models",
]
const HEALTHCHECK_ROUTE_PATTERNS = [
  "/api/health",
  "/healthz",
  "/readyz",
  "/livez",
]
const STATIC_ASSET_PATTERNS = [
  "/_next/",
  ".js",
  ".css",
  ".map",
  ".png",
  ".jpg",
  ".svg",
]

type TraceSamplerConfig = {
  chatHealthyRate: number
  chatFailureRate: number
  chatClientErrorRate: number
  criticalApiRate: number
  defaultApiRate: number
  frontendRate: number
  healthcheckRate: number
  staticAssetRate: number
}

type SentrySamplingContext = {
  name?: string
  attributes?: Record<string, unknown>
  transactionContext?: {
    name?: string
  }
  parentSampled?: boolean
  inheritOrSampleWith?: (sampleRate: number) => boolean | number
}

type SentryTransactionEvent = {
  transaction?: string
  contexts?: Record<string, unknown>
  tags?: Record<string, unknown>
}

function clampRate(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function parseRateFromEnv(envKey: string, fallback: number): number {
  const raw = process.env[envKey]
  if (!raw) return fallback
  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) ? clampRate(parsed) : fallback
}

function loadTraceSamplerConfig(): TraceSamplerConfig {
  return {
    chatHealthyRate: parseRateFromEnv("SENTRY_TRACES_RATE_CHAT_HEALTHY", 0.25),
    chatFailureRate: parseRateFromEnv("SENTRY_TRACES_RATE_CHAT_FAILURE", 1),
    chatClientErrorRate: parseRateFromEnv(
      "SENTRY_TRACES_RATE_CHAT_CLIENT_ERROR",
      0.5
    ),
    criticalApiRate: parseRateFromEnv("SENTRY_TRACES_RATE_CRITICAL_API", 0.2),
    defaultApiRate: parseRateFromEnv("SENTRY_TRACES_RATE_DEFAULT_API", 0.05),
    frontendRate: parseRateFromEnv("SENTRY_TRACES_RATE_FRONTEND", 0.01),
    healthcheckRate: parseRateFromEnv("SENTRY_TRACES_RATE_HEALTHCHECK", 0),
    staticAssetRate: parseRateFromEnv("SENTRY_TRACES_RATE_STATIC_ASSET", 0),
  }
}

const traceSamplerConfig = loadTraceSamplerConfig()

function sampleWithInheritance(
  samplingContext: SentrySamplingContext,
  sampleRate: number
): boolean | number {
  if (typeof samplingContext.inheritOrSampleWith === "function") {
    return samplingContext.inheritOrSampleWith(sampleRate)
  }
  if (typeof samplingContext.parentSampled === "boolean") {
    return samplingContext.parentSampled
  }
  return sampleRate
}

function getTransactionName(samplingContext: SentrySamplingContext): string {
  const route =
    (typeof samplingContext.attributes?.["http.route"] === "string"
      ? samplingContext.attributes?.["http.route"]
      : undefined) ??
    (typeof samplingContext.attributes?.["http.target"] === "string"
      ? samplingContext.attributes?.["http.target"]
      : undefined) ??
    samplingContext.transactionContext?.name ??
    samplingContext.name ??
    ""

  return route.toLowerCase()
}

function parseNumericStatus(value: unknown): number | undefined {
  if (typeof value === "number") return value
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number.parseInt(value, 10)
    return Number.isNaN(parsed) ? undefined : parsed
  }
  return undefined
}

function getEnvelopeChatRate(): number {
  return Math.max(
    traceSamplerConfig.chatHealthyRate,
    traceSamplerConfig.chatClientErrorRate,
    traceSamplerConfig.chatFailureRate
  )
}

function getChatTargetRateForStatus(statusCode: number | undefined): number {
  if (typeof statusCode === "number" && statusCode >= 500) {
    return traceSamplerConfig.chatFailureRate
  }
  if (typeof statusCode === "number" && statusCode >= 400) {
    return traceSamplerConfig.chatClientErrorRate
  }
  return traceSamplerConfig.chatHealthyRate
}

function shouldKeepWithRate(sampleRate: number): boolean {
  if (sampleRate <= 0) return false
  if (sampleRate >= 1) return true
  return Math.random() < sampleRate
}

function getTransactionNameFromEvent(event: SentryTransactionEvent): string {
  if (typeof event.transaction === "string") {
    return event.transaction.toLowerCase()
  }
  const routeTag = event.tags?.["http.route"]
  if (typeof routeTag === "string") {
    return routeTag.toLowerCase()
  }
  return ""
}

function getStatusCodeFromTransactionEvent(
  event: SentryTransactionEvent
): number | undefined {
  const responseContext = event.contexts?.["response"] as
    { status_code?: unknown } | undefined
  const statusFromContext = parseNumericStatus(responseContext?.status_code)
  if (typeof statusFromContext === "number") return statusFromContext

  const tags = event.tags
  const statusFromTags = parseNumericStatus(
    tags?.["http.response.status_code"] ??
      tags?.["http.status_code"] ??
      tags?.["status_code"]
  )
  if (typeof statusFromTags === "number") return statusFromTags

  return undefined
}

function hasAnyPattern(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => value.includes(pattern))
}

export function sentryTracesSampler(
  samplingContext: SentrySamplingContext
): boolean | number {
  if (process.env.NODE_ENV !== "production") {
    return sampleWithInheritance(samplingContext, 1)
  }

  const transactionName = getTransactionName(samplingContext)
  // Health checks and assets are low-value and often high-volume.
  if (hasAnyPattern(transactionName, HEALTHCHECK_ROUTE_PATTERNS)) {
    return sampleWithInheritance(
      samplingContext,
      traceSamplerConfig.healthcheckRate
    )
  }
  if (hasAnyPattern(transactionName, STATIC_ASSET_PATTERNS)) {
    return sampleWithInheritance(
      samplingContext,
      traceSamplerConfig.staticAssetRate
    )
  }

  // High-fidelity chat traces for reliability SLOs and release regression detection.
  if (transactionName.includes(CHAT_ROUTE_PATTERN)) {
    // Response status is not available when tracesSampler executes.
    // We sample at the max chat rate, then down-sample by final status
    // inside sentryBeforeSendTransaction once status_code is known.
    return sampleWithInheritance(samplingContext, getEnvelopeChatRate())
  }

  // Keep strong fidelity for other chat-critical API routes.
  if (hasAnyPattern(transactionName, CHAT_CRITICAL_ROUTE_PATTERNS)) {
    return sampleWithInheritance(
      samplingContext,
      traceSamplerConfig.criticalApiRate
    )
  }

  // Down-sample lower-value API traffic.
  if (transactionName.includes("/api/")) {
    return sampleWithInheritance(
      samplingContext,
      traceSamplerConfig.defaultApiRate
    )
  }

  // Lowest baseline for frontend/navigation traces.
  return sampleWithInheritance(samplingContext, traceSamplerConfig.frontendRate)
}

export function sentryBeforeSendTransaction<T extends SentryTransactionEvent>(
  event: T
): T | null {
  if (process.env.NODE_ENV !== "production") {
    return event
  }

  const transactionName = getTransactionNameFromEvent(event)
  if (!transactionName.includes(CHAT_ROUTE_PATTERN)) {
    return event
  }

  const envelopeRate = getEnvelopeChatRate()
  if (envelopeRate <= 0) {
    return null
  }

  const statusCode = getStatusCodeFromTransactionEvent(event)
  const targetRate = getChatTargetRateForStatus(statusCode)
  const keepRate = clampRate(targetRate / envelopeRate)

  return shouldKeepWithRate(keepRate) ? event : null
}
