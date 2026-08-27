/**
 * Versioned machine-readable result schema for the browser benchmark
 * (measurement plan Phase 3 §3.2 / Phase 6). Raw runs are kept alongside the
 * aggregates so a later analysis can re-derive percentiles; content never
 * appears — correctness is carried as a hash plus booleans.
 */

export type MetricSummary = {
  p50: number
  p75: number
  p95: number
  max: number
}

export type RunMetrics = {
  /** Client-mark-derived intervals (ms). Missing when the mark pair was absent. */
  sendToOptimisticPaintMs?: number
  sendToRequestDispatchedMs?: number
  dispatchToFirstStreamChunkMs?: number
  firstTextDeltaToFirstVisibleMs?: number
  sendToFirstVisibleTextMs?: number
  streamDurationMs?: number
  stopToTerminalMs?: number
  /** Responsiveness (from app-emitted marks during the run window). */
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
  /** Correctness. */
  correctness: {
    ok: boolean
    foldedTextHash: string
    expectedTextHash: string
    terminalOutcome: string | null
    settleMismatchCount: number
    detail?: string
  }
}

export type ScenarioResult = {
  scenario: string
  directive: string
  viewport: string
  cpuThrottle: number
  action: "complete" | "stop"
  sampleCount: number
  warmupRuns: number
  correctnessOk: boolean
  metrics: Record<string, MetricSummary>
  runs: RunMetrics[]
}

export type BenchmarkResultFile = {
  schemaVersion: 1
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
  baseUrl: string
  suite: string
  scenarios: ScenarioResult[]
}

export function summarize(values: number[]): MetricSummary {
  if (values.length === 0) return { p50: 0, p75: 0, p95: 0, max: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
  return {
    p50: round2(at(0.5)),
    p75: round2(at(0.75)),
    p95: round2(at(0.95)),
    max: round2(sorted[sorted.length - 1]),
  }
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100
}
