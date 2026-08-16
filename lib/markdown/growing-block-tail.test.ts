import { describe, expect, it } from "vitest"
import {
  analyzeFenceOpener,
  analyzeOpenFence,
  clipUnprovenTableTail,
  mendGrowingBlockTail,
} from "./growing-block-tail"
import {
  advanceMarkdownProjection,
  splitMarkdownSource,
  type MarkdownProjectionState,
} from "./incremental-block-projection"

/**
 * Stream `source` through the projection in fixed chunks, asserting at every
 * newline-terminated prefix that the projection's blocks are byte-identical
 * to the authoritative full parse (partition equivalence at line
 * granularity), then settle and assert equivalence again. Returns how many
 * steps handed characters to the parser — the perf gate: the line-extension
 * fast path must make parse steps RARE, not per-update.
 */
function streamAndVerify(source: string, chunkSize = 3) {
  let state: MarkdownProjectionState | null = null
  let parseSteps = 0
  let steps = 0
  for (let end = chunkSize; end < source.length + chunkSize; end += chunkSize) {
    const prefix = source.slice(0, Math.min(end, source.length))
    const result = advanceMarkdownProjection({
      previous: state,
      source: prefix,
      streaming: true,
      identity: "m1",
    })
    state = result.state
    steps++
    if (result.parsedCharacters > 0) parseSteps++
    if (prefix.endsWith("\n")) {
      const authoritative = splitMarkdownSource(prefix)
      expect(
        state.blocks.map(({ text, nodeType, startOffset, endOffset }) => ({
          text,
          nodeType,
          startOffset,
          endOffset,
        }))
      ).toEqual(authoritative)
    }
    if (prefix.length === source.length) break
  }
  const settled = advanceMarkdownProjection({
    previous: state,
    source,
    streaming: false,
    identity: "m1",
  })
  expect(settled.settleMismatch).toBe(false)
  expect(
    settled.state.blocks.map(({ text, nodeType, startOffset, endOffset }) => ({
      text,
      nodeType,
      startOffset,
      endOffset,
    }))
  ).toEqual(splitMarkdownSource(source))
  return { parseSteps, steps }
}

function orderedList(count: number, separator = "\n") {
  return (
    Array.from(
      { length: count },
      (_, i) => `${i + 1}. Item sentence number ${i + 1} about harbors.`
    ).join(separator) + "\n"
  )
}

describe("terminal-block line-extension fast path (projection)", () => {
  it("streams a tight ordered list with almost no parse steps", () => {
    const { parseSteps, steps } = streamAndVerify(orderedList(60))
    expect(steps).toBeGreaterThan(300)
    expect(parseSteps).toBeLessThanOrEqual(4)
  })

  it("streams a loose (blank-separated) ordered list with almost no parse steps", () => {
    const { parseSteps } = streamAndVerify(orderedList(40, "\n\n"))
    expect(parseSteps).toBeLessThanOrEqual(4)
  })

  it("streams a bullet list, including lazy and indented continuations", () => {
    const source =
      Array.from(
        { length: 30 },
        (_, i) => `- bullet ${i + 1}\n  indented continuation ${i + 1}`
      ).join("\n") + "\nlazy tail continuation\n"
    const { parseSteps } = streamAndVerify(source)
    expect(parseSteps).toBeLessThanOrEqual(4)
  })

  it("bails to the parser when the list ends into a paragraph, then stays cheap", () => {
    const source = `${orderedList(20)}\nA plain paragraph closes the list.\n\n${orderedList(10)}`
    const { parseSteps, steps } = streamAndVerify(source)
    expect(parseSteps).toBeLessThan(steps / 4)
  })

  it("handles a fence interrupting a list without a blank line", () => {
    streamAndVerify("1. a\n2. b\n```\ninterrupting code\n```\nafter\n")
  })

  it("keeps thematic-break and setext bait authoritative", () => {
    streamAndVerify("- a\n- b\n---\nafter break\n")
    streamAndVerify("1. a\n2. b\n===\nafter\n")
  })

  it("bails when the bullet marker char changes (new list per CommonMark)", () => {
    streamAndVerify("- a\n- b\n* c\n* d\n")
  })

  it("streams an open fence with interior bait lines cheaply, closing correctly", () => {
    const interior = Array.from(
      { length: 60 },
      (_, i) => `const line${i} = ${i}`
    )
    interior.splice(10, 0, "", "    ```", "x``` not a closer", "")
    const source = "```ts\n" + interior.join("\n") + "\n```\n\nafter\n"
    const { parseSteps } = streamAndVerify(source)
    expect(parseSteps).toBeLessThanOrEqual(6)
  })

  it("honors a longer opener: ``` lines inside a ```` fence stay interior", () => {
    streamAndVerify("````md\n```\ninner fence\n```\n````\n")
  })

  it("streams a mixed document (prose + list + fence) equivalently", () => {
    const source =
      "# Title\n\nIntro paragraph with some words.\n\n" +
      orderedList(15) +
      "\nClosing paragraph.\n\n```js\nconst a = 1\nconst b = 2\n```\n\nDone.\n"
    streamAndVerify(source)
  })

  it("streams word-sized chunks equivalently (throttle-shaped appends)", () => {
    streamAndVerify(orderedList(25), 7)
    streamAndVerify(orderedList(25), 1)
  })
})

describe("analyzeOpenFence", () => {
  it("can read opener facts without scanning or rejecting a closed interior", () => {
    const fence = analyzeFenceOpener("````ts twoslash\n```\n````")
    expect(fence).toMatchObject({
      marker: "`",
      minCloserLength: 4,
      language: "ts",
      interiorStart: 16,
    })
  })

  it("recognizes an open fence and its language", () => {
    const fence = analyzeOpenFence("```ts twoslash\nconst a = 1\n")
    expect(fence).toMatchObject({
      marker: "`",
      minCloserLength: 3,
      language: "ts",
    })
  })

  it("returns null for closed fences, indented code, and invalid openers", () => {
    expect(analyzeOpenFence("```\ncode\n```")).toBeNull()
    expect(analyzeOpenFence("    indented code")).toBeNull()
    expect(analyzeOpenFence("```a`b\ncode\n")).toBeNull()
  })
})

describe("render-boundary tail mending (ADR-0016 amendment 2026-08-11)", () => {
  it("completes unclosed inline delimiters at the tail", () => {
    expect(mendGrowingBlockTail("selecting the right **Apache Fl")).toBe(
      "selecting the right **Apache Fl**"
    )
    expect(mendGrowingBlockTail("a *forming ital")).toBe("a *forming ital*")
    expect(mendGrowingBlockTail("run `bun ad")).toBe("run `bun ad`")
    expect(mendGrowingBlockTail("was ~~drop")).toBe("was ~~drop~~")
  })

  it("renders a partial link as its label text only", () => {
    const mended = mendGrowingBlockTail(
      "see [Apache Spark Documentation](https://spark.apa"
    )
    expect(mended).not.toContain("](")
    expect(mended).toContain("Apache Spark Documentation")
  })

  it("leaves complete text, snake_case, and code-span delimiters alone", () => {
    expect(mendGrowingBlockTail("**bold** and *italic* done.")).toBe(
      "**bold** and *italic* done."
    )
    expect(mendGrowingBlockTail("uses snake_case_name here")).toBe(
      "uses snake_case_name here"
    )
    expect(mendGrowingBlockTail("markers like `**` stay")).toBe(
      "markers like `**` stay"
    )
  })

  it("gates an unproven table candidate (header, partial delimiter row)", () => {
    expect(clipUnprovenTableTail("| Benchmark | Input Size |")).toBe("")
    expect(
      clipUnprovenTableTail("| Benchmark | Input Size |\n|-----------|----")
    ).toBe("")
    expect(clipUnprovenTableTail("Intro prose.\n| A | B |")).toBe(
      "Intro prose."
    )
  })

  it("gates a newline-terminated header row awaiting its delimiter row", () => {
    // Regression: the empty split segment after a trailing newline must not
    // break the pipe-led run scan — this exact state (header emitted, next
    // row not started) previously rendered the raw row.
    expect(clipUnprovenTableTail("| A | B |\n")).toBe("")
    expect(clipUnprovenTableTail("Intro prose.\n| A | B |\n")).toBe(
      "Intro prose."
    )
  })

  it("does not gate consecutive pipe-led shell pipeline prose", () => {
    const pipeline =
      'curl https://api.example.com/items\n| jq ".items[]"\n| sort\n'
    expect(clipUnprovenTableTail(pipeline)).toBe(pipeline)
    expect(clipUnprovenTableTail(pipeline.trimEnd())).toBe(pipeline.trimEnd())
  })

  it("gates and proves blockquoted tables like top-level ones", () => {
    expect(clipUnprovenTableTail("> | A | B |")).toBe("")
    expect(clipUnprovenTableTail("Quote intro.\n> | A | B |\n")).toBe(
      "Quote intro."
    )
    const provenQuoted = "> | A | B |\n> |---|---|\n> | a1 | b"
    expect(clipUnprovenTableTail(provenQuoted)).toBe(provenQuoted)
  })

  it("keeps a proven table (complete delimiter row) intact", () => {
    const proven = "| A | B |\n|---|---|\n| a1 | b"
    expect(clipUnprovenTableTail(proven)).toBe(proven)
    const provenNewline = "| A | B |\n|---|---|\n"
    expect(clipUnprovenTableTail(provenNewline)).toBe(provenNewline)
  })

  it("does not treat a terminal partial delimiter row as proof", () => {
    expect(clipUnprovenTableTail("| A | B |\n|---|---|")).toBe("")
  })

  it("leaves pipe-free text and non-trailing pipes untouched", () => {
    expect(clipUnprovenTableTail("plain prose line")).toBe("plain prose line")
    const settledTableThenProse = "| A | B |\n|---|---|\n| a | b |\n\ndone"
    expect(clipUnprovenTableTail(settledTableThenProse)).toBe(
      settledTableThenProse
    )
  })

  it("mend = clip + remend composed", () => {
    expect(mendGrowingBlockTail("Results below **matter\n| A | B |")).toBe(
      "Results below **matter**"
    )
  })
})
