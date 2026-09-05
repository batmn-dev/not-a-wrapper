/**
 * Versioned machine-readable browser benchmark results. Raw runs stay alongside
 * aggregates so a later analysis can re-derive percentiles; content never
 * appears — correctness is carried as a hash plus booleans.
 */

export type MetricSummary = {
  /** Sample count. 0 means no run produced the metric; the percentiles are then 0, not measurements. */
  n: number
  p50: number
  p75: number
  /** Omitted below 20 samples; ten observations do not establish a tail percentile. */
  p95?: number
  max: number
}

export type RunMetrics = {
  ui?: Record<string, number[]>
  /** Foreground loss invalidates interactive timings. */
  hiddenDuringMeasurement?: boolean
  pendingDeltaSamples?: number
  droppedUiSamples?: number
  /** Client-mark-derived intervals (ms). Missing when the mark pair was absent. */
  sendToOptimisticPaintMs?: number
  /** First turns only: Send → `/c/<chatId>` committed by the session (ADR-0033). */
  sendToThreadRouteCommittedMs?: number
  sendToRequestDispatchedMs?: number
  dispatchToFirstStreamChunkMs?: number
  firstTextDeltaToFirstVisibleMs?: number
  sendToFirstVisibleTextMs?: number
  streamDurationMs?: number
  stopToTerminalMs?: number
  /** Source lengths distinguish actual growth from shorter terminal reconciliation. */
  stopSourceLengths?: { atReady: number; after250Ms: number; afterSettlement?: number }
  /** Full observed task/frame intervals overlapping the run window, including delayed callbacks. */
  longTaskCount: number
  longTaskMaxMs: number
  totalBlockingTimeMs: number
  rafGapCount: number
  rafGapMaxMs: number
  /** Rendering cost. */
  markdownProjectionCount: number
  markdownProjectionMaxMs: number
  shikiHighlightCount: number
  shikiHighlightTotalMs: number
  /** Publication accounting (last summary in the run window). */
  callbackCount?: number
  publicationCount?: number
  coalescedCount?: number
  /** DOM/heap growth over the run. */
  domNodesBefore: number
  domNodesAfter: number
  jsHeapUsedBeforeBytes?: number
  jsHeapUsedAfterBytes?: number
  /** Server spans joined by correlation id (ms), when the server was sampled. */
  serverSpans?: Record<string, number>
  /**
   * The run timing receipt's durations (ADR-0030) joined by correlation id,
   * when the server was sampled: prepareMs, providerFirstOutputMs,
   * firstWriteDelayMs, modelResponseMs, toolExecutionMs, wireStreamMs.
   */
  timingReceipt?: Record<string, number>
  /** Durable worker-wire writes joined by correlation id (durable runs). */
  durableWrites?: {
    snapshotCount: number
    snapshotMeanMs: number
    snapshotMaxMs: number
    otherOps: Record<string, number>
  }
  /** Cross-tab freshness (second-tab runs): accepted checkpoint → tab-2 render. */
  snapshotToSecondTabMedianMs?: number
  snapshotToSecondTabMaxMs?: number
  /** Tab-1 terminal mark → tab-2 settlement receipt mark (second-tab runs). */
  terminalToSecondTabSettledMs?: number
  /** Reload runs: navigation start → authoritative content / settlement receipt. */
  reloadToAuthoritativeMs?: number
  reloadToSettlementReceiptMs?: number
  /** Signed receipt offset from local terminal; negative means already settled. */
  terminalToSettlementReceiptMs?: number
  /**
   * Durable send lost live-stream adoption after the hard navigation — the
   * turn settled server-side and rendered via snapshots only. Counted per
   * scenario; such runs contribute no stream-latency samples.
   */
  liveStreamNotAdopted?: boolean
  /** Correctness. */
  correctness: {
    ok: boolean
    foldedTextHash: string
    expectedTextHash: string
    terminalOutcome: string | null
    settlementOutcome?: string | null
    settleMismatchCount: number
    detail?: string
  }
}

export type ScenarioResult = {
  id: string
  network: "unthrottled" | "constrained"
  cache: "cold" | "warm"
  auth: boolean
  followup: boolean
  /** Native wheel timing uses an explicit pre-input position snapshot. */
  wheelProtocol?: "prepared-wheel-v1"
  scenario: string
  directive: string
  viewport: string
  cpuThrottle: number
  action: "complete" | "stop" | "second-tab" | "reload"
  sampleCount: number
  warmupRuns: number
  correctnessOk: boolean
  /** Runs whose live stream was never adopted (durable adoption-loss count). */
  liveStreamNotAdoptedRuns?: number
  metrics: Record<string, MetricSummary>
  runs: RunMetrics[]
}

/** One switch's observations (ms; undefined = not measurable on that switch). */
export type ThreadSwitchSample = {
  navToPaintedMs: number | undefined
  intentToCommitMs: number | undefined
  commitToFirstContentMs: number | undefined
  firstContentToPaintedMs: number | undefined
  cache: "hit" | "miss" | undefined
  querySetAdds: number
  ok: boolean
  detail?: string
}

export type ThreadSwitchPassResult = {
  kind: "unvisited-click" | "unvisited-hover" | "visited"
  switches: number
  /** The raw per-switch observations behind the summaries below. */
  samples: ThreadSwitchSample[]
  /** `chat_navigation_intent` → `nav_to_thread_painted` per switch. */
  navToThreadPaintedMs: MetricSummary
  /** `chat_navigation_intent` → `chat_route_state_committed` per switch. */
  intentToRouteCommitMs: MetricSummary
  /** Route commit → the commit that first rendered a message row (0 = same commit). */
  commitToFirstContentMs: MetricSummary
  /** First-row commit → the painted mark (two rAFs plus whatever delays them). */
  firstContentToPaintedMs: MetricSummary
  /** `navigation_cache_hit_or_miss` at the route commit. */
  cacheHits: number
  cacheMisses: number
  /** Convex `ModifyQuerySet` `Add` frames sent per switch. */
  querySetAddsPerSwitch: MetricSummary
}

/** `SUITE=thread-switch` (see thread-switch.ts). */
export type ThreadSwitchResult = {
  chatCount: number
  switchCount: number
  hoverMs: number
  documents: number
  passes: ThreadSwitchPassResult[]
  /** Forced-GC JS heap through the visited pass, keyed by switch count. */
  heapSamples: Array<{ switches: number; jsHeapUsedBytes: number }>
  correctnessOk: boolean
  detail?: string
}

export type BenchmarkResultFile = {
  schemaVersion: 2
  measurementVersion: "dom-frame-v2"
  replayPolicy: "disabled-v1"
  identityProtocol: "ci-isolated-v1" | "attached-session-v1"
  profiled?: boolean
  generatedAt: string
  commit: string
  buildId: string
  buildClass: "production"
  instrumentationBuild: boolean
  machineClass: string
  cpuModel: string
  cpuCount: number
  memoryGb: number
  osVersion: string
  browserVersion: string
  /** Hash of the complete deterministic scripts, including timing and content. */
  fixtureHash: string
  baseUrl: string
  suite: string
  scenarios: ScenarioResult[]
  threadSwitch?: ThreadSwitchResult
}

export function summarize(values: number[]): MetricSummary {
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error("Performance samples must be finite numbers")
  }
  if (values.length === 0) return { n: 0, p50: 0, p75: 0, max: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
  return {
    n: sorted.length,
    p50: round2(at(0.5)),
    p75: round2(at(0.75)),
    ...(sorted.length >= 20 ? { p95: round2(at(0.95)) } : {}),
    max: round2(sorted[sorted.length - 1]),
  }
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100
}
