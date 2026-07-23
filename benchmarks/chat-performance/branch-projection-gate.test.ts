/**
 * PR 1 release gate (plan §8.1 #2): the single-pass candidate must project
 * the 1,150-row tree in ≈5 ms p95 after warm-up — blocking only in the
 * controlled benchmark environment (`CHAT_PERF_GATES=true`), never on noisy
 * shared CI runners. The output-hash equivalence half of the gate always
 * runs; only the timing assertion is environment-gated.
 *
 * Run: CHAT_PERF_GATES=true bun run test benchmarks/chat-performance/branch-projection-gate.test.ts
 */
import { describe, expect, it } from "vitest"
import {
  assertProjectionEquivalence,
  buildDeterministicBranchTree,
  currentBranchImplementation,
  measure,
  singlePassBranchImplementation,
} from "./fixtures"

const TIMING_GATE_ENABLED = process.env.CHAT_PERF_GATES === "true"
const P95_BUDGET_MS = 5

describe("branch projection release gate", () => {
  const tree575 = buildDeterministicBranchTree(575)
  const tree1150 = buildDeterministicBranchTree(1150)

  it("candidate output equals legacy on the gate trees (always blocking)", () => {
    assertProjectionEquivalence(
      [currentBranchImplementation, singlePassBranchImplementation],
      tree575,
      "575-row tree"
    )
    assertProjectionEquivalence(
      [currentBranchImplementation, singlePassBranchImplementation],
      tree1150,
      "1150-row tree"
    )
  })

  it.runIf(TIMING_GATE_ENABLED)(
    `1,150-row single-pass projection stays under ~${P95_BUDGET_MS} ms p95 after warm-up`,
    () => {
      const result = measure(
        () => singlePassBranchImplementation.project(tree1150),
        { warmupIterations: 10, sampleCount: 50 }
      )
      const result575 = measure(
        () => singlePassBranchImplementation.project(tree575),
        { warmupIterations: 10, sampleCount: 50 }
      )
      // 575-row result is reported alongside the gate (plan PR 1 acceptance).
      console.log(
        `[chat-performance] gate: 1150-row median=${result.medianMs.toFixed(2)}ms p95=${result.p95Ms.toFixed(2)}ms; ` +
          `575-row median=${result575.medianMs.toFixed(2)}ms p95=${result575.p95Ms.toFixed(2)}ms`
      )
      expect(result.p95Ms).toBeLessThan(P95_BUDGET_MS)
    }
  )
})
