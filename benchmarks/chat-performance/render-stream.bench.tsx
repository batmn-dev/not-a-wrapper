/**
 * Streaming-render benchmark (plan PR 0a: Markdown/Shiki direction).
 *
 * Reproduces the two supplied client findings against the real production
 * modules:
 *  - Markdown: `parseMarkdownIntoBlocks` re-parses the full accumulated
 *    string on every text update (components/ui/markdown.tsx).
 *  - Shiki: `CodeBlockCode` re-highlights the complete code string on every
 *    delta (components/ui/code-block.tsx uses the same `codeToHtml` call).
 *
 * Growth states are sampled from the deterministic stream fixture so a full
 * per-delta replay stays bounded; the direction (per-update cost grows with
 * accumulated size, streaming replay >> one settled pass) is what later
 * phases must preserve or eliminate. Exact historical numbers are not a gate.
 *
 * Run with: bun run bench:chat
 */
import { parseMarkdownIntoBlocks, Markdown } from "@/components/ui/markdown"
import { renderToString } from "react-dom/server"
import { createHighlighter } from "shiki"
import { bench, describe } from "vitest"
import {
  buildCodePayload,
  buildLongMarkdownPayload,
  buildManyShortBlocksPayload,
  buildMarkdownPayload,
  buildShortProsePayload,
  buildStreamScript,
  describeBenchEnvironment,
  foldStreamScript,
  type StreamChunkEvent,
} from "./fixtures"

const GROWTH_SAMPLE_COUNT = 40

/** Accumulated-text snapshots after every Nth text delta of a script. */
function sampleGrowthStates(
  events: StreamChunkEvent[],
  sampleCount: number
): string[] {
  const accumulated: string[] = []
  let text = ""
  for (const event of events) {
    if (event.type === "text-delta") {
      text += event.delta
      accumulated.push(text)
    }
  }
  const step = Math.max(1, Math.floor(accumulated.length / sampleCount))
  const samples = accumulated.filter((_, index) => index % step === step - 1)
  const last = accumulated[accumulated.length - 1]
  if (last !== undefined && samples[samples.length - 1] !== last) {
    samples.push(last)
  }
  return samples
}

const markdownScript = buildStreamScript({
  scenario: "mixed-markdown",
  chunksPerSecond: 30,
})
const codeScript = buildStreamScript({
  scenario: "code-block",
  chunksPerSecond: 30,
})

// Loud determinism gate before timing anything: the folded stream must
// reproduce the exact payloads the growth states are sampled from.
const foldedMarkdown = foldStreamScript(markdownScript)
if (foldedMarkdown.text !== buildMarkdownPayload()) {
  throw new Error("mixed-markdown stream did not reproduce its payload")
}
const foldedCode = foldStreamScript(codeScript)
if (!foldedCode.text.includes(buildCodePayload())) {
  throw new Error("code-block stream did not reproduce its payload")
}

const markdownGrowth = sampleGrowthStates(markdownScript, GROWTH_SAMPLE_COUNT)
const settledMarkdown = markdownGrowth[markdownGrowth.length - 1]!

// The growing fenced block exactly as CodeBlockCode receives it: code inside
// the fence, still open while streaming.
const codeGrowth = sampleGrowthStates(codeScript, GROWTH_SAMPLE_COUNT).map(
  (state) => {
    const fenceStart = state.indexOf("```ts\n")
    const body = fenceStart >= 0 ? state.slice(fenceStart + 6) : state
    const fenceEnd = body.indexOf("\n```")
    return fenceEnd >= 0 ? body.slice(0, fenceEnd) : body
  }
)
const settledCode = buildCodePayload()

console.log(
  "[chat-performance] environment:",
  JSON.stringify(await describeBenchEnvironment())
)

// Same themes as production; the language actually exercised plus the `text`
// fallback keeps highlighter startup bounded. Initialization is recorded
// separately from highlight cost (plan PR 3 step 7 distinguishes them).
const initStart = performance.now()
const highlighter = await createHighlighter({
  themes: ["github-dark", "github-light"],
  langs: ["typescript", "text"],
})
console.log(
  `[chat-performance] shiki highlighter initialization: ${(
    performance.now() - initStart
  ).toFixed(1)} ms`
)

// Tail-growth states: the SAME small terminal paragraph grows by a few
// characters per update on top of a fixed completed prefix. Under the full
// splitter, per-update cost tracks total accumulated size; the plan's §6
// gate is that incremental projection makes it track the tail instead.
function sampleTailGrowthStates(base: string, steps = 40): string[] {
  const states: string[] = []
  let tail = ""
  for (let i = 0; i < steps; i++) {
    tail += ` word${i}`
    states.push(base + tail)
  }
  return states
}

const shortProse = buildShortProsePayload()
const longMarkdown = buildLongMarkdownPayload()
const manyShortBlocks = buildManyShortBlocksPayload()
const markdownTailGrowth = sampleTailGrowthStates(buildMarkdownPayload())
const longTailGrowth = sampleTailGrowthStates(longMarkdown)
const manyBlocksTailGrowth = sampleTailGrowthStates(manyShortBlocks)

describe("markdown splitter scaling (streaming plan §5 baseline)", () => {
  bench(
    "per-update split, ~500 B short prose (40 tail-growth states)",
    () => {
      for (const state of sampleTailGrowthStates(shortProse)) {
        parseMarkdownIntoBlocks(state)
      }
    },
    { warmupIterations: 2, iterations: 10, time: 0, warmupTime: 0 }
  )

  bench(
    "per-update split, ~12 KB mixed payload (40 tail-growth states)",
    () => {
      for (const state of markdownTailGrowth) parseMarkdownIntoBlocks(state)
    },
    { warmupIterations: 2, iterations: 10, time: 0, warmupTime: 0 }
  )

  bench(
    "per-update split, ~100 KB payload with short tail (40 tail-growth states)",
    () => {
      for (const state of longTailGrowth) parseMarkdownIntoBlocks(state)
    },
    { warmupIterations: 1, iterations: 5, time: 0, warmupTime: 0 }
  )

  bench(
    "per-update split, 400 short blocks with small tail (40 tail-growth states)",
    () => {
      for (const state of manyBlocksTailGrowth) parseMarkdownIntoBlocks(state)
    },
    { warmupIterations: 1, iterations: 5, time: 0, warmupTime: 0 }
  )
})

describe("markdown splitter (components/ui/markdown.tsx)", () => {
  bench(
    "split settled ~12 KB payload once",
    () => {
      parseMarkdownIntoBlocks(settledMarkdown)
    },
    { warmupIterations: 5, iterations: 30, time: 0, warmupTime: 0 }
  )

  bench(
    `re-split across ${markdownGrowth.length} sampled growth states (streaming)`,
    () => {
      for (const state of markdownGrowth) parseMarkdownIntoBlocks(state)
    },
    { warmupIterations: 2, iterations: 10, time: 0, warmupTime: 0 }
  )
})

describe("markdown React render (production Markdown component)", () => {
  bench(
    "render settled payload once",
    () => {
      renderToString(<Markdown id="bench-settled">{settledMarkdown}</Markdown>)
    },
    { warmupIterations: 2, iterations: 10, time: 0, warmupTime: 0 }
  )

  bench(
    "render 10 sampled growth states (streaming, no memo reuse across passes)",
    () => {
      for (const state of markdownGrowth.filter((_, i) => i % 4 === 3)) {
        renderToString(<Markdown id="bench-growing">{state}</Markdown>)
      }
    },
    { warmupIterations: 1, iterations: 5, time: 0, warmupTime: 0 }
  )
})

describe("shiki full-block highlight (components/ui/code-block.tsx)", () => {
  bench(
    "highlight settled 400-line block once",
    () => {
      highlighter.codeToHtml(settledCode, {
        lang: "typescript",
        theme: "github-dark",
      })
    },
    { warmupIterations: 3, iterations: 15, time: 0, warmupTime: 0 }
  )

  bench(
    `re-highlight across ${codeGrowth.length} sampled growth states (per-delta behavior)`,
    () => {
      for (const state of codeGrowth) {
        highlighter.codeToHtml(state, {
          lang: "typescript",
          theme: "github-dark",
        })
      }
    },
    { warmupIterations: 1, iterations: 3, time: 0, warmupTime: 0 }
  )
})
