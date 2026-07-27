/**
 * Release gate for the incremental Markdown projection (plan §6 pass
 * criteria): per-update projection cost must track the mutable tail, not the
 * accumulated source. The ~100 KB payload carries the SAME growing terminal
 * paragraph as the ~12 KB payload, so its per-update cost must stay within
 * the plan's 2× p95 ratio bound (the legacy splitter measured ~10× —
 * 88.6 ms vs 8.7 ms — in the 2026-07-27 baseline).
 *
 * Correctness is not gated here (the equivalence corpus in
 * lib/markdown/incremental-block-projection.test.ts owns that); this file
 * gates the scaling claim so a regression to accumulated-size work fails CI.
 */
import {
  advanceMarkdownProjection,
  type MarkdownProjectionState,
} from "@/lib/markdown/incremental-block-projection"
import { describe, expect, it } from "vitest"
import {
  buildLongMarkdownPayload,
  buildMarkdownPayload,
  measure,
} from "./fixtures"

const IDENTITY = "gate-message"
const STEPS = 40

function growthTails(): string[] {
  const tails: string[] = []
  let tail = ""
  for (let i = 0; i < STEPS; i++) {
    tail += ` word${i}`
    tails.push(tail)
  }
  return tails
}

const TAILS = growthTails()

function primeProjection(base: string): MarkdownProjectionState {
  return advanceMarkdownProjection({
    previous: null,
    source: base,
    streaming: true,
    identity: IDENTITY,
  }).state
}

function replay(base: string, primed: MarkdownProjectionState) {
  let state = primed
  for (const tail of TAILS) {
    const result = advanceMarkdownProjection({
      previous: state,
      source: base + tail,
      streaming: true,
      identity: IDENTITY,
    })
    if (result.fallbackReason !== null || result.reset) {
      throw new Error(
        `gate replay left the fast path: ${result.fallbackReason ?? result.resetReason}`
      )
    }
    state = result.state
  }
}

describe("incremental projection scaling gate", () => {
  it("keeps ~100 KB per-update cost within 2× the ~12 KB cost (p95)", () => {
    const mediumBase = buildMarkdownPayload()
    const longBase = buildLongMarkdownPayload()
    const mediumPrimed = primeProjection(mediumBase)
    const longPrimed = primeProjection(longBase)

    const medium = measure(() => replay(mediumBase, mediumPrimed), {
      warmupIterations: 3,
      sampleCount: 15,
    })
    const long = measure(() => replay(longBase, longPrimed), {
      warmupIterations: 3,
      sampleCount: 15,
    })

    // Ratio gate from the plan: same-sized tail ⇒ comparable per-update
    // cost regardless of accumulated size. 2× p95 bound, plus an absolute
    // floor so timer noise on sub-millisecond samples cannot flake the gate.
    const ratio = long.p95Ms / Math.max(medium.p95Ms, 0.5)
    expect(
      ratio,
      `p95 per-replay: 12KB=${medium.p95Ms.toFixed(2)}ms 100KB=${long.p95Ms.toFixed(2)}ms`
    ).toBeLessThanOrEqual(2)
  })
})
