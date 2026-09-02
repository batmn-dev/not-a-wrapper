/**
 * Compares browser benchmark results against a baseline captured on the same
 * runner class — absolute numbers do not transfer across hardware, so the
 * gate is relative (percentage) with an absolute slack floor that keeps
 * small-millisecond metrics from tripping on scheduler noise.
 *
 * Usage:
 *   bun run benchmarks/chat-performance/browser/compare-results.ts \
 *     <baseline.json> <current.json>
 *
 * Exit codes: 0 = pass (or baseline missing — reported, not fatal, so a
 * first scheduled run can bootstrap the baseline); 1 = correctness failure
 * or threshold breach.
 */
import { existsSync, readFileSync } from "node:fs"
import type { BenchmarkResultFile, ScenarioResult } from "./result-schema"

type Threshold = {
  /** p50 may regress by this fraction of the baseline… */
  relative: number
  /** …but a breach also needs to exceed this absolute delta (ms/count). */
  absoluteFloor: number
}

/**
 * Gated metrics and their tolerance. Deliberately few and user-facing —
 * every addition is a future flake candidate on shared runners.
 */
const GATES: Record<string, Threshold> = {
  sendToFirstVisibleTextMs: { relative: 0.35, absoluteFloor: 150 },
  totalBlockingTimeMs: { relative: 0.5, absoluteFloor: 100 },
  markdownProjectionMaxMs: { relative: 0.5, absoluteFloor: 20 },
  // Run timing receipt segments this server owns (ADR-0030). The provider
  // segments never gate: the deterministic script fixes them, and the harness
  // correctness-checks the receipt against that script instead.
  prepareMs: { relative: 0.35, absoluteFloor: 40 },
  firstWriteDelayMs: { relative: 0.5, absoluteFloor: 20 },
  pacingOverheadMs: { relative: 0.5, absoluteFloor: 50 },
  settlementTotalMs: { relative: 0.5, absoluteFloor: 100 },
  stopToTerminalMs: { relative: 0.5, absoluteFloor: 20 },
}

function fail(message: string): never {
  console.error(`[compare-results] ${message}`)
  process.exit(1)
}

function scenarioKey(scenario: ScenarioResult): string {
  return `${scenario.scenario}/${scenario.action}/${scenario.viewport}/x${scenario.cpuThrottle}`
}

const [baselinePath, currentPath] = process.argv.slice(2)
if (!baselinePath || !currentPath) {
  fail("usage: compare-results.ts <baseline.json> <current.json>")
}
if (!existsSync(currentPath)) fail(`current results not found: ${currentPath}`)
const current = JSON.parse(
  readFileSync(currentPath, "utf8")
) as BenchmarkResultFile

// Correctness is absolute and baseline-independent: a current run with any
// correctness failure never passes, baseline or not.
const badCorrectness = current.scenarios.filter((s) => !s.correctnessOk)
if (badCorrectness.length > 0) {
  fail(
    `correctness failed in: ${badCorrectness.map(scenarioKey).join(", ")} — timings are invalid`
  )
}

if (!existsSync(baselinePath)) {
  console.log(
    `[compare-results] no baseline at ${baselinePath} — correctness passed; ` +
      `commit the current results file there to arm regression gating.`
  )
  process.exit(0)
}
const baseline = JSON.parse(
  readFileSync(baselinePath, "utf8")
) as BenchmarkResultFile

if (baseline.schemaVersion !== current.schemaVersion) {
  fail(
    `schema version mismatch (baseline ${baseline.schemaVersion}, current ${current.schemaVersion}) — regenerate the baseline`
  )
}

const baselineByKey = new Map(
  baseline.scenarios.map((s) => [scenarioKey(s), s])
)
const currentByKey = new Map(current.scenarios.map((s) => [scenarioKey(s), s]))
const missingBaselineScenarios = [...baselineByKey.keys()].filter(
  (key) => !currentByKey.has(key)
)
if (missingBaselineScenarios.length > 0) {
  fail(
    `baseline scenario(s) missing from current results: ${missingBaselineScenarios.join(", ")}`
  )
}
const missingCurrentP50s = [...baselineByKey].flatMap(([key, base]) => {
  const scenario = currentByKey.get(key)
  if (!scenario) return []
  return Object.keys(GATES)
    .filter(
      (metric) =>
        base.metrics[metric]?.p50 !== undefined &&
        scenario.metrics[metric]?.p50 === undefined
    )
    .map((metric) => `${key} ${metric}`)
})
if (missingCurrentP50s.length > 0) {
  fail(
    `baseline metric p50(s) missing from current results: ${missingCurrentP50s.join(", ")}`
  )
}
const breaches: string[] = []
let compared = 0

for (const scenario of current.scenarios) {
  const base = baselineByKey.get(scenarioKey(scenario))
  if (!base) {
    console.log(
      `[compare-results] ${scenarioKey(scenario)}: not in baseline — skipped (regenerate the baseline to gate it)`
    )
    continue
  }
  for (const [metric, threshold] of Object.entries(GATES)) {
    const basedP50 = base.metrics[metric]?.p50
    const currentP50 = scenario.metrics[metric]?.p50
    if (basedP50 === undefined || currentP50 === undefined) continue
    if (basedP50 === 0 && currentP50 === 0) continue
    compared++
    const allowed = Math.max(
      basedP50 * threshold.relative,
      threshold.absoluteFloor
    )
    const delta = currentP50 - basedP50
    const line = `${scenarioKey(scenario)} ${metric}: ${basedP50} -> ${currentP50} (Δ${delta >= 0 ? "+" : ""}${Math.round(delta * 10) / 10}, allowed +${Math.round(allowed)})`
    if (delta > allowed) breaches.push(line)
    else console.log(`[compare-results] ok  ${line}`)
  }
}

if (breaches.length > 0) {
  console.error(`[compare-results] ${breaches.length} regression(s):`)
  for (const line of breaches) console.error(`  REGRESSED  ${line}`)
  process.exit(1)
}
console.log(
  `[compare-results] pass — ${compared} metric comparisons within thresholds`
)
