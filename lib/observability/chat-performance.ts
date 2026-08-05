/**
 * Chat-performance instrumentation core (chat-responsiveness plan, PR 0b).
 *
 * Content-free by construction: every event passes a per-event field
 * allow-list before emission; string fields must match a declared enum or the
 * correlation-id shape, and any string containing a credential-shaped value
 * is rejected outright. Prompts, outputs, tool payloads, keys, grants,
 * tokens, and chat/message/run IDs can never be emitted — there is no field
 * that accepts them.
 *
 * Off by default on both sides:
 * - Client: `NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION === "true"` (build-time —
 *   changing it is a redeploy, not a live toggle). Marks go to the User
 *   Timing API (`performance.mark`), the substrate the measurement runbook's
 *   traces read; nothing is sent over the network by this module.
 * - Server: `CHAT_PERF_SAMPLE_RATE` (0..1, default 0) samples per request.
 *   Sampled spans/counters emit one structured JSON log line
 *   (`_tag: "chat_perf"`), matching the repository's structured-log pattern.
 *
 * Correlation: the client generates a random UUID per sampled turn and sends
 * it as the `x-chat-perf-id` header; the route validates shape/length and
 * carries it through its spans. It is never persisted to chat/run/message
 * documents, never reused across turns, and is explicitly NOT a usage
 * admission idempotency key (plan PR 0 acceptance).
 */
import { containsSecret } from "./secret-patterns"

// ---------------------------------------------------------------------------
// Enablement and sampling
// ---------------------------------------------------------------------------

export function isChatPerfClientEnabled(): boolean {
  return process.env.NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION === "true"
}

export function getChatPerfServerSampleRate(): number {
  const raw = process.env.CHAT_PERF_SAMPLE_RATE
  if (!raw) return 0
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return 0
  return Math.min(1, Math.max(0, parsed))
}

// ---------------------------------------------------------------------------
// Correlation id (x-chat-perf-id)
// ---------------------------------------------------------------------------

export const CHAT_PERF_ID_HEADER = "x-chat-perf-id"

const CORRELATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function createChatPerfCorrelationId(): string {
  return crypto.randomUUID()
}

/**
 * Validates an incoming header value. Invalid, absent, or oversized values
 * are dropped silently (plan PR 0 acceptance) — never echoed into logs.
 */
export function parseChatPerfIdHeader(
  value: string | null | undefined
): string | undefined {
  if (!value || value.length > 64) return undefined
  const normalized = value.toLowerCase()
  return CORRELATION_ID_PATTERN.test(normalized) ? normalized : undefined
}

// ---------------------------------------------------------------------------
// Event schema (allow-list; unknown fields and free-form strings rejected)
// ---------------------------------------------------------------------------

type FieldSpec =
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "enum"; values: readonly string[] }
  | { kind: "correlation" }

const NUMBER: FieldSpec = { kind: "number" }
const BOOLEAN: FieldSpec = { kind: "boolean" }
const CORRELATION: FieldSpec = { kind: "correlation" }
const oneOf = (...values: string[]): FieldSpec => ({ kind: "enum", values })

const TERMINAL_OUTCOMES = [
  "finish",
  "error",
  "abort",
  "disconnect",
] as const

export const CHAT_PERF_SPAN_NAMES = [
  "request_parse",
  "auth_session",
  "usage_admission",
  "model_config",
  "credential_resolution",
  "tool_preparation",
  "durable_prepare",
  "message_validation",
  "model_bound_validation",
  "attachment_resolution",
  "history_adaptation",
  "stream_start",
  "prepare_total",
] as const

export type ChatPerfSpanName = (typeof CHAT_PERF_SPAN_NAMES)[number]

export const DETACHED_BINDING_GAUGE_EVENTS = [
  "created",
  "detached",
  "adopted",
  "readopted",
  "readopt_rejected_divergent",
  "finished_attached",
  "finished_detached",
  "watchdog_stop",
] as const

export type DetachedBindingGaugeEvent =
  (typeof DETACHED_BINDING_GAUGE_EVENTS)[number]

/**
 * Every event this module can emit, with its complete field allow-list.
 * A field absent here cannot be emitted; a string field that is not an
 * allow-listed enum or the correlation id cannot exist.
 */
const EVENT_SCHEMAS: Record<string, Record<string, FieldSpec>> = {
  // --- client turn marks (plan PR 0 step 3) ---
  chat_send_intent: { correlationId: CORRELATION },
  optimistic_message_painted: { correlationId: CORRELATION },
  request_dispatched: { correlationId: CORRELATION },
  first_chunk_received: { correlationId: CORRELATION },
  first_visible_text: { correlationId: CORRELATION, textLengthBucket: NUMBER },
  stream_terminal: {
    correlationId: CORRELATION,
    outcome: oneOf(...TERMINAL_OUTCOMES),
  },
  durable_settlement_receipt: {
    outcome: oneOf("completed", "failed", "aborted"),
  },
  // --- incremental Markdown projection anomalies (ADR-0016) ---
  // Rare by design: resets (non-prefix corrections, identity churn),
  // incremental fallbacks (fast path could not prove safety), and settlement
  // mismatches (incremental output disagreed with the authoritative parse —
  // authoritative wins, this mark is the alarm). Content-free reasons only.
  markdown_projection_reset: {
    reason: oneOf(
      "identity-changed",
      "parser-version-changed",
      "source-shrunk",
      "source-diverged"
    ),
  },
  markdown_projection_fallback: {
    reason: oneOf(
      "no-safe-restart-boundary",
      "tail-misaligned",
      "context-divergence"
    ),
  },
  markdown_projection_settle_mismatch: {},
  // --- client navigation marks (plan PR 0 step 3) ---
  chat_navigation_intent: {},
  chat_route_state_committed: {},
  first_thread_content_painted: { messageCount: NUMBER },
  authoritative_thread_content_received: { messageCount: NUMBER },
  navigation_cache_hit_or_miss: { cache: oneOf("hit", "miss") },
  // --- client derivation counters ---
  selected_conversation_client: {
    selectedCount: NUMBER,
    mappingDurationMs: NUMBER,
  },
  detached_binding_gauge: {
    event: oneOf(...DETACHED_BINDING_GAUGE_EVENTS),
    attachedCount: NUMBER,
    detachedCount: NUMBER,
    bindingClass: oneOf("durable", "guest", "unowned"),
  },
  // --- server spans / counters (plan PR 0 steps 4–5) ---
  server_span: {
    span: oneOf(...CHAT_PERF_SPAN_NAMES),
    durationMs: NUMBER,
    ok: BOOLEAN,
    correlationId: CORRELATION,
  },
  checkpoint: {
    kind: oneOf(
      "attempt",
      "accepted",
      "authority_lost",
      "failed",
      "final_flush",
      "settlement_receipt_confirmed",
      "settlement_receipt_degraded"
    ),
    payloadBytes: NUMBER,
    correlationId: CORRELATION,
  },
}

export type ChatPerfEventName = keyof typeof EVENT_SCHEMAS & string

export type ChatPerfFields = Record<string, string | number | boolean>

export type ChatPerfValidation =
  | { ok: true }
  | { ok: false; reason: string }

/**
 * The schema gate every emission passes. Rejects unknown events, unknown
 * fields (including unknown STRING fields — the leak-prevention rule the
 * plan names), type mismatches, enum violations, malformed correlation ids,
 * non-finite numbers, and any string containing a credential-shaped value.
 */
export function validateChatPerfEvent(
  name: string,
  fields: ChatPerfFields
): ChatPerfValidation {
  const schema = EVENT_SCHEMAS[name]
  if (!schema) return { ok: false, reason: `unknown event: ${name}` }

  for (const [key, value] of Object.entries(fields)) {
    const spec = schema[key]
    if (!spec) return { ok: false, reason: `unknown field: ${key}` }
    switch (spec.kind) {
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value)) {
          return { ok: false, reason: `field ${key} must be a finite number` }
        }
        break
      case "boolean":
        if (typeof value !== "boolean") {
          return { ok: false, reason: `field ${key} must be a boolean` }
        }
        break
      case "enum":
        if (typeof value !== "string" || !spec.values.includes(value)) {
          return { ok: false, reason: `field ${key} outside its enum` }
        }
        break
      case "correlation":
        if (
          typeof value !== "string" ||
          parseChatPerfIdHeader(value) === undefined
        ) {
          return { ok: false, reason: `field ${key} is not a correlation id` }
        }
        break
    }
    if (typeof value === "string" && containsSecret(value)) {
      return { ok: false, reason: `field ${key} contains a secret shape` }
    }
  }

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Client marks (User Timing)
// ---------------------------------------------------------------------------

const CLIENT_MARK_PREFIX = "chat-perf:"

/**
 * Emits one content-free User Timing mark. Zero-call when instrumentation is
 * disabled; invalid events are dropped, never partially emitted. Never
 * throws — instrumentation failure must not affect chat behavior.
 */
export function markChatPerf(
  name: ChatPerfEventName,
  fields: ChatPerfFields = {}
): void {
  if (!isChatPerfClientEnabled()) return
  if (typeof performance === "undefined" || !performance.mark) return
  if (!validateChatPerfEvent(name, fields).ok) return
  try {
    performance.mark(`${CLIENT_MARK_PREFIX}${name}`, {
      detail: { ...fields },
    })
  } catch {
    // Marks are best-effort diagnostics only.
  }
}

// ---------------------------------------------------------------------------
// Server session (spans + counters, per-request sampling)
// ---------------------------------------------------------------------------

export type ChatPerfServerSession = {
  sampled: boolean
  correlationId: string | undefined
  /**
   * Wraps one preparation stage. Never alters control flow: the wrapped
   * function's result/rejection passes through unchanged, the span always
   * closes (failure paths included), and the emitted record carries only the
   * span name, duration, ok flag, and correlation id — never the error.
   */
  span<T>(name: ChatPerfSpanName, fn: () => Promise<T>): Promise<T>
  /**
   * Records a span whose duration was measured externally (e.g.
   * `stream_start` = request receipt → immediately before `streamText`).
   */
  record(name: ChatPerfSpanName, durationMs: number, ok?: boolean): void
  counter(kind: string, payloadBytes?: number): void
}

function emitServerEvent(name: ChatPerfEventName, fields: ChatPerfFields) {
  if (!validateChatPerfEvent(name, fields).ok) return
  try {
    console.log(JSON.stringify({ _tag: "chat_perf", event: name, ...fields }))
  } catch {
    // Best-effort diagnostics only.
  }
}

const NOOP_SESSION: ChatPerfServerSession = {
  sampled: false,
  correlationId: undefined,
  span: (_name, fn) => fn(),
  record: () => {},
  counter: () => {},
}

/**
 * Per-request server session. Not sampled → the shared no-op session (zero
 * allocation on the hot path beyond this call). The optional `random`/`rate`
 * parameters exist for tests only.
 */
export function createChatPerfServerSession(
  headerValue: string | null | undefined,
  options?: { rate?: number; random?: () => number }
): ChatPerfServerSession {
  const rate = options?.rate ?? getChatPerfServerSampleRate()
  if (rate <= 0) return NOOP_SESSION
  if ((options?.random ?? Math.random)() >= rate) return NOOP_SESSION

  const correlationId = parseChatPerfIdHeader(headerValue)
  const withCorrelation = (fields: ChatPerfFields): ChatPerfFields =>
    correlationId ? { ...fields, correlationId } : fields

  return {
    sampled: true,
    correlationId,
    async span(name, fn) {
      const start = performance.now()
      let ok = false
      try {
        const result = await fn()
        ok = true
        return result
      } finally {
        emitServerEvent(
          "server_span",
          withCorrelation({
            span: name,
            durationMs: Math.round((performance.now() - start) * 100) / 100,
            ok,
          })
        )
      }
    },
    record(name, durationMs, ok = true) {
      emitServerEvent(
        "server_span",
        withCorrelation({
          span: name,
          durationMs: Math.max(0, Math.round(durationMs * 100) / 100),
          ok,
        })
      )
    },
    counter(kind, payloadBytes) {
      emitServerEvent(
        "checkpoint",
        withCorrelation({
          kind,
          ...(payloadBytes !== undefined
            ? { payloadBytes: Math.max(0, Math.round(payloadBytes)) }
            : {}),
        })
      )
    },
  }
}
