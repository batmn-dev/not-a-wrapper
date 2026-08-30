import type {
  DeterministicDeliveryShape,
  DeterministicPerfScenario,
} from "@/app/api/chat/deterministic-provider"

export type BrowserScenarioConfig = {
  id: string
  scenario: DeterministicPerfScenario
  chunksPerSecond: number
  shape: DeterministicDeliveryShape
  viewport: "desktop" | "mobile"
  cpuThrottle: 1 | 4
  /**
   * complete/stop run in one tab; second-tab opens the durable chat in a
   * second page mid-stream and measures snapshot→render freshness; reload
   * reloads the sending tab mid-stream and measures recovery.
   */
  action: "complete" | "stop" | "second-tab" | "reload"
  /** Expected `stream_terminal` outcome. */
  expectedOutcome: "finish" | "error" | "abort"
  /** Sign in as the harness test user — the turn runs the durable path. */
  auth?: boolean
}

const base = {
  viewport: "desktop" as const,
  cpuThrottle: 1 as const,
  action: "complete" as const,
  expectedOutcome: "finish" as const,
}

/**
 * The standard suite is the representative slice run on every benchmark.
 * The full Cartesian
 * matrix stays a manual/scheduled exercise.
 */
export const STANDARD_SUITE: BrowserScenarioConfig[] = [
  { ...base, id: "text-only-30-fixed", scenario: "text-only", chunksPerSecond: 30, shape: "fixed" },
  { ...base, id: "mixed-markdown-30-fixed", scenario: "mixed-markdown", chunksPerSecond: 30, shape: "fixed" },
  { ...base, id: "code-block-30-fixed", scenario: "code-block", chunksPerSecond: 30, shape: "fixed" },
  { ...base, id: "long-markdown-100-fixed", scenario: "long-markdown", chunksPerSecond: 100, shape: "fixed" },
  { ...base, id: "code-stress-30-fixed", scenario: "code-stress", chunksPerSecond: 30, shape: "fixed" },
  { ...base, id: "mixed-markdown-100-bursty", scenario: "mixed-markdown", chunksPerSecond: 100, shape: "bursty" },
  { ...base, id: "mixed-markdown-30-slab", scenario: "mixed-markdown", chunksPerSecond: 30, shape: "slab" },
  { ...base, id: "mixed-markdown-30-fixed-mobile", scenario: "mixed-markdown", chunksPerSecond: 30, shape: "fixed", viewport: "mobile" },
  { ...base, id: "mixed-markdown-30-fixed-cpu4", scenario: "mixed-markdown", chunksPerSecond: 30, shape: "fixed", cpuThrottle: 4 },
  { ...base, id: "partial-error-30-fixed", scenario: "partial-error", chunksPerSecond: 30, shape: "fixed", expectedOutcome: "error" },
  { ...base, id: "stop-during-text-10-fixed", scenario: "stop-during-text", chunksPerSecond: 10, shape: "fixed", action: "stop", expectedOutcome: "abort" },
]

/** A three-scenario smoke slice for harness bring-up and CI sanity. */
export const SMOKE_SUITE: BrowserScenarioConfig[] = [
  STANDARD_SUITE[0],
  STANDARD_SUITE[1],
  STANDARD_SUITE[10],
]

/**
 * Authenticated durable-path scenarios: real WorkOS session, server chat ids,
 * prepareGeneration, snapshots, and settlement.
 * Kept as a separate suite so the guest baseline stays comparable.
 */
export const DURABLE_SUITE: BrowserScenarioConfig[] = [
  { ...base, id: "durable-mixed-30-fixed", scenario: "mixed-markdown", chunksPerSecond: 30, shape: "fixed", auth: true },
  { ...base, id: "durable-text-30-second-tab", scenario: "text-only", chunksPerSecond: 30, shape: "fixed", auth: true, action: "second-tab" },
  { ...base, id: "durable-text-30-reload", scenario: "text-only", chunksPerSecond: 30, shape: "fixed", auth: true, action: "reload" },
  { ...base, id: "durable-stop-10-fixed", scenario: "stop-during-text", chunksPerSecond: 10, shape: "fixed", auth: true, action: "stop", expectedOutcome: "abort" },
  // Pause-heavy delivery: three 20 s zero-delta gaps
  // while the run stays live — heartbeat/run-doc writes are the only durable
  // traffic in a gap, which is the read-amplification event class the split
  // subscription exists for. ~70 s of wall clock per run; trim RUNS via env
  // when iterating.
  { ...base, id: "durable-text-30-paused", scenario: "text-only", chunksPerSecond: 30, shape: "paused", auth: true },
]

export function directiveFor(config: BrowserScenarioConfig): string {
  return `[[perf:${config.scenario}:${config.chunksPerSecond}:${config.shape}]]`
}
