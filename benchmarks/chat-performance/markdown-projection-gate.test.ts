/**
 * Release gates for the incremental Markdown projection (plan §6 pass
 * criteria): per-update projection cost must track the mutable region plus
 * appended text, never the accumulated source.
 *
 * The scaling gate samples EACH update individually (fixed 2026-07-27
 * review P2: the earlier version timed a 40-update batch, letting a slow
 * isolated update hide inside the aggregate): p95 over every per-update
 * sample of the ~100 KB payload must stay within the plan's 2× bound of
 * the ~12 KB payload's per-update p95 — both carry the same growing tail.
 * The legacy splitter measured ~10× (88.6 ms vs 8.7 ms per update) in the
 * 2026-07-27 baseline.
 *
 * The construct gates pin the plan's other required cases to the fast
 * path with tail-proportional parse work: growing fenced code, growing
 * table construction, and the one-very-long-paragraph bound (a single
 * paragraph IS the mutable region, so its cost is its own length — that
 * expectation is asserted, not hidden).
 *
 * Correctness is not gated here (the equivalence corpus in
 * lib/markdown/incremental-block-projection.test.ts and the rendered-DOM
 * corpus in components/ui/markdown.equivalence.test.tsx own that).
 */
import {
  advanceMarkdownProjection,
  type MarkdownProjectionState,
} from "@/lib/markdown/incremental-block-projection"
import { describe, expect, it } from "vitest"
import { buildLongMarkdownPayload, buildMarkdownPayload } from "./fixtures"

const IDENTITY = "gate-message"
const STEPS = 40
const REPLAYS = 15

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

/** One replay, timing EVERY update separately; asserts the fast path held. */
function samplePerUpdate(
  base: string,
  primed: MarkdownProjectionState,
  samples: number[]
) {
  let state = primed
  for (const tail of TAILS) {
    const start = performance.now()
    const result = advanceMarkdownProjection({
      previous: state,
      source: base + tail,
      streaming: true,
      identity: IDENTITY,
    })
    samples.push(performance.now() - start)
    if (result.fallbackReason !== null || result.reset) {
      throw new Error(
        `gate replay left the fast path: ${result.fallbackReason ?? result.resetReason}`
      )
    }
    state = result.state
  }
}

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)] ?? 0
}

describe("incremental projection scaling gate", () => {
  it("keeps ~100 KB PER-UPDATE cost within 2× the ~12 KB per-update cost (p95)", () => {
    const mediumBase = buildMarkdownPayload()
    const longBase = buildLongMarkdownPayload()
    const mediumPrimed = primeProjection(mediumBase)
    const longPrimed = primeProjection(longBase)

    // Warmup, then interleave replays so JIT/GC drift hits both cases alike.
    const mediumSamples: number[] = []
    const longSamples: number[] = []
    samplePerUpdate(mediumBase, mediumPrimed, [])
    samplePerUpdate(longBase, longPrimed, [])
    for (let replay = 0; replay < REPLAYS; replay++) {
      samplePerUpdate(mediumBase, mediumPrimed, mediumSamples)
      samplePerUpdate(longBase, longPrimed, longSamples)
    }

    const mediumP95 = p95(mediumSamples)
    const longP95 = p95(longSamples)
    // Absolute floor on the denominator so sub-0.25 ms timer noise cannot
    // flake the ratio; the gate exists to catch a regression back to
    // accumulated-size work (which measures ~90 ms, not fractions of a ms).
    const ratio = longP95 / Math.max(mediumP95, 0.25)
    expect(
      ratio,
      `per-update p95: 12KB=${mediumP95.toFixed(3)}ms 100KB=${longP95.toFixed(3)}ms over ${longSamples.length} samples`
    ).toBeLessThanOrEqual(2)
  })

  it("growing fenced code stays on the fast path with tail-proportional work", () => {
    const stablePrefix = buildMarkdownPayload()
    const fenceOpen = stablePrefix + "\n```ts\n"
    let state = primeProjection(fenceOpen)
    let code = ""
    for (let line = 0; line < 40; line++) {
      code += `const generated${line} = ${line} * 2\n`
      const result = advanceMarkdownProjection({
        previous: state,
        source: fenceOpen + code,
        streaming: true,
        identity: IDENTITY,
      })
      expect(result.fallbackReason).toBeNull()
      expect(result.reset).toBe(false)
      // Work is bounded by the open fence + context, never the ~12 KB prefix.
      expect(result.parsedCharacters).toBeLessThan(code.length + 2048)
      state = result.state
    }
  })

  it("growing table construction stays on the fast path with tail-proportional work", () => {
    const stablePrefix = buildMarkdownPayload()
    const tableStart = stablePrefix + "\n| col A | col B |\n| --- | --- |\n"
    let state = primeProjection(tableStart)
    let rows = ""
    for (let row = 0; row < 40; row++) {
      rows += `| a${row} | b${row} |\n`
      const result = advanceMarkdownProjection({
        previous: state,
        source: tableStart + rows,
        streaming: true,
        identity: IDENTITY,
      })
      expect(result.fallbackReason).toBeNull()
      expect(result.reset).toBe(false)
      expect(result.parsedCharacters).toBeLessThan(rows.length + 2048)
      state = result.state
    }
  })

  it("one very long paragraph is bounded by its own length (the mutable region)", () => {
    // A single paragraph never yields a stable boundary: the whole block is
    // the mutable region, so per-update work IS the paragraph. This gate
    // documents that bound and catches an accidental super-linear step
    // (e.g. re-entering the full document twice per update).
    const sentence = "A very long paragraph keeps growing without a blank line. "
    let paragraph = sentence.repeat(40)
    let state = primeProjection(paragraph)
    for (let i = 0; i < 10; i++) {
      paragraph += sentence
      const result = advanceMarkdownProjection({
        previous: state,
        source: paragraph,
        streaming: true,
        identity: IDENTITY,
      })
      expect(result.reset).toBe(false)
      expect(result.parsedCharacters).toBeLessThanOrEqual(paragraph.length)
      state = result.state
    }
  })
})
