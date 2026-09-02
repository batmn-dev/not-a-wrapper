import { v, type Infer } from "convex/values"

/**
 * Run timing receipt (CONTEXT.md, ADR-0030): the durable, content-free record
 * stamped on a generation run at every terminal write of where that run's
 * time went. Durations are milliseconds on a monotonic clock; every field is
 * optional and absent means unobserved — nothing is ever zero-filled. Per
 * run, never accumulated across an approval continuation.
 *
 * Segment anchors (all measured in the Next.js process on performance.now):
 *  - prepareMs            HTTP receipt → provider dispatch (auth, admission,
 *                         durable prepare, history adaptation).
 *  - providerFirstOutputMs dispatch → first output chunk of the first step
 *                         (AI SDK step performance, sampled upstream of every
 *                         transform; anchored at the provider call attempt
 *                         that succeeded, so SDK retry backoff is outside it).
 *  - firstWriteDelayMs    first output chunk → that chunk released to the
 *                         response stream (transforms, smoothing holdback,
 *                         UI-stream conversion); same attempt anchor.
 *  - modelResponseMs      Σ per-step provider response time (SDK). Provider-
 *                         executed (hosted) tools run inside it.
 *  - toolExecutionMs      Σ per-step CLIENT-side tool execution (SDK); hosted
 *                         tools contribute nothing here.
 *  - wireStreamMs         first output chunk released → finish part released
 *                         to the response stream, as observed in-process (the
 *                         same tail the SDK's response time spans, so the
 *                         pacing overhead below compares like with like).
 *  - settlementMs         settle start → terminal write dispatch (drain +
 *                         final flush); the terminal write itself is excluded
 *                         because the receipt rides it.
 *  - buildId              short commit identity of the server build.
 */
export const RUN_TIMING_RECEIPT_DURATION_FIELDS = [
  "prepareMs",
  "providerFirstOutputMs",
  "firstWriteDelayMs",
  "modelResponseMs",
  "toolExecutionMs",
  "wireStreamMs",
  "settlementMs",
] as const

export type RunTimingReceiptDurationField =
  (typeof RUN_TIMING_RECEIPT_DURATION_FIELDS)[number]

export const vRunTimingReceipt = v.object({
  prepareMs: v.optional(v.number()),
  providerFirstOutputMs: v.optional(v.number()),
  firstWriteDelayMs: v.optional(v.number()),
  modelResponseMs: v.optional(v.number()),
  toolExecutionMs: v.optional(v.number()),
  wireStreamMs: v.optional(v.number()),
  settlementMs: v.optional(v.number()),
  buildId: v.optional(v.string()),
})

export type RunTimingReceipt = Infer<typeof vRunTimingReceipt>

/**
 * How long a stopped worker may still attach its receipt after an absorbing
 * terminal (user Stop, supersession) revoked its grant without carrying one.
 * The worker learns of the Stop through its heartbeat and settles within
 * seconds; the window only has to outlast that plus the settle drain.
 */
export const TIMING_RECEIPT_ATTACH_WINDOW_MS = 60_000

// Short commit SHA or a release string like `not-a-wrapper@1.2.3`; mirrored by
// lib/observability/build-identity.ts.
const BUILD_ID_PATTERN = /^[A-Za-z0-9._@+-]{1,64}$/

/**
 * Drop malformed values before persistence: non-finite or negative durations
 * and build ids outside the short identifier grammar. Returns undefined when
 * nothing survives so an empty receipt is never written.
 */
export function sanitizeRunTimingReceipt(
  raw: RunTimingReceipt | undefined
): RunTimingReceipt | undefined {
  if (!raw) return undefined
  const receipt: RunTimingReceipt = {}
  for (const field of RUN_TIMING_RECEIPT_DURATION_FIELDS) {
    const value = raw[field]
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      receipt[field] = value
    }
  }
  if (typeof raw.buildId === "string" && BUILD_ID_PATTERN.test(raw.buildId)) {
    receipt.buildId = raw.buildId
  }
  return Object.keys(receipt).length > 0 ? receipt : undefined
}

// Derived figures. Computed at read time from stored facts, never stored.

/** Server-side time to first output: prepare + provider first output + first-write delay. */
export function serverTimeToFirstOutputMs(
  receipt: RunTimingReceipt
): number | undefined {
  const { prepareMs, providerFirstOutputMs, firstWriteDelayMs } = receipt
  if (
    prepareMs === undefined ||
    providerFirstOutputMs === undefined ||
    firstWriteDelayMs === undefined
  ) {
    return undefined
  }
  return prepareMs + providerFirstOutputMs + firstWriteDelayMs
}

/**
 * Time the response pipeline added on top of what the provider and tools
 * took: the released output window minus the provider's output window
 * (model response minus the first step's time to first output — later steps'
 * own first-output waits are inside the released window too) minus tool
 * execution. Watch this when touching smoothing or the UI-stream conversion.
 */
export function pacingOverheadMs(
  receipt: RunTimingReceipt
): number | undefined {
  const {
    wireStreamMs,
    modelResponseMs,
    providerFirstOutputMs,
    toolExecutionMs,
  } = receipt
  if (
    wireStreamMs === undefined ||
    modelResponseMs === undefined ||
    providerFirstOutputMs === undefined
  ) {
    return undefined
  }
  return (
    wireStreamMs -
    (modelResponseMs - providerFirstOutputMs) -
    (toolExecutionMs ?? 0)
  )
}
