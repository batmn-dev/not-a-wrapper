import { describe, expect, it } from "vitest"
import {
  buildDeterministicBranchTree,
  measure,
  singlePassBranchImplementation,
} from "./fixtures"

const TIMING_GATE_ENABLED = process.env.CHAT_PERF_GATES === "true"
const P95_BUDGET_MS = 5

describe("branch projection performance", () => {
  it.runIf(TIMING_GATE_ENABLED)(
    `keeps the 1,150-row production projection under ${P95_BUDGET_MS} ms p95`,
    () => {
      const tree = buildDeterministicBranchTree(1150)
      const result = measure(
        () => singlePassBranchImplementation.project(tree),
        { warmupIterations: 10, sampleCount: 50 }
      )

      expect(result.p95Ms).toBeLessThan(P95_BUDGET_MS)
    }
  )
})
