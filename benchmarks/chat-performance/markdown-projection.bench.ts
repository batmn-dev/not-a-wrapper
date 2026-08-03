/**
 * Incremental Markdown projection benchmark (ADR-0016).
 *
 * Compares the legacy full splitter (re-parse everything per update) against
 * `advanceMarkdownProjection` (parse only the mutable tail) on the same
 * tail-growth sequences the baseline report used: a fixed completed prefix
 * with a short terminal paragraph growing a few characters per update.
 *
 * Run with: bun run bench:chat
 */
import {
  advanceMarkdownProjection,
  splitMarkdownSource,
  type MarkdownProjectionState,
} from "@/lib/markdown/incremental-block-projection"
import { bench, describe } from "vitest"
import {
  buildLongMarkdownPayload,
  buildManyShortBlocksPayload,
  buildMarkdownPayload,
  buildShortProsePayload,
} from "./fixtures"

const IDENTITY = "bench-message"
const STEPS = 40

function growthTails(steps = STEPS): string[] {
  const tails: string[] = []
  let tail = ""
  for (let i = 0; i < steps; i++) {
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

/** One full 40-update replay from the primed state (the timed unit). */
function replayProjection(base: string, primed: MarkdownProjectionState) {
  let state = primed
  for (const tail of TAILS) {
    state = advanceMarkdownProjection({
      previous: state,
      source: base + tail,
      streaming: true,
      identity: IDENTITY,
    }).state
  }
  return state
}

function replayFullSplitter(base: string) {
  let last: unknown
  for (const tail of TAILS) {
    last = splitMarkdownSource(base + tail)
  }
  return last
}

const CASES: Array<{ name: string; base: string }> = [
  { name: "~500 B short prose", base: buildShortProsePayload() },
  { name: "~12 KB mixed payload", base: buildMarkdownPayload() },
  { name: "~100 KB payload, short tail", base: buildLongMarkdownPayload() },
  { name: "400 short blocks, small tail", base: buildManyShortBlocksPayload() },
  // Remaining projection cases: one very long paragraph (the whole
  // block is the mutable region — the honest lower bound), growing table
  // construction, and a growing fenced block on a completed prefix.
  {
    name: "one very long paragraph",
    base: "A single paragraph that never breaks. ".repeat(300),
  },
  {
    name: "growing table on ~12 KB prefix",
    base:
      buildMarkdownPayload() +
      "\n| col A | col B |\n| --- | --- |\n" +
      Array.from({ length: 30 }, (_, i) => `| a${i} | b${i} |`).join("\n") +
      "\n",
  },
  {
    name: "growing fence on ~12 KB prefix",
    base:
      buildMarkdownPayload() +
      "\n```ts\n" +
      Array.from({ length: 30 }, (_, i) => `const generated${i} = ${i}`).join("\n") +
      "\n",
  },
]

for (const testCase of CASES) {
  const primed = primeProjection(testCase.base)
  describe(`tail growth ×${STEPS}: ${testCase.name}`, () => {
    bench(
      "legacy full splitter",
      () => {
        replayFullSplitter(testCase.base)
      },
      { warmupIterations: 1, iterations: 5, time: 0, warmupTime: 0 }
    )
    bench(
      "incremental projection",
      () => {
        replayProjection(testCase.base, primed)
      },
      { warmupIterations: 2, iterations: 10, time: 0, warmupTime: 0 }
    )
  })
}
