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
  action: "complete" | "stop"
  /** Expected `stream_terminal` outcome. */
  expectedOutcome: "finish" | "error" | "abort"
}

const base = {
  viewport: "desktop" as const,
  cpuThrottle: 1 as const,
  action: "complete" as const,
  expectedOutcome: "finish" as const,
}

/**
 * The standard suite (measurement plan §3.3): the most representative slice
 * of the full matrix, run on every benchmark invocation. The full Cartesian
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

export function directiveFor(config: BrowserScenarioConfig): string {
  return `[[perf:${config.scenario}:${config.chunksPerSecond}:${config.shape}]]`
}
