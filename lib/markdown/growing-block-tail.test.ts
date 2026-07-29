import { describe, expect, it } from "vitest"
import {
  advanceMarkdownProjection,
  splitMarkdownSource,
  type MarkdownProjectionState,
} from "./incremental-block-projection"
import {
  advanceGrowingListSegments,
  analyzeOpenFence,
  GROWING_LIST_SEGMENT_MIN_CHARS,
  initialGrowingListSegmentsState,
} from "./growing-block-tail"

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
  for (
    let end = chunkSize;
    end < source.length + chunkSize;
    end += chunkSize
  ) {
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

describe("advanceGrowingListSegments", () => {
  const bigList = orderedList(300)

  it("freezes fragments append-only with exact concatenation", () => {
    let state = initialGrowingListSegmentsState()
    const seenFragments: string[] = []
    for (let end = 40; end < bigList.length + 40; end += 40) {
      const text = bigList.slice(0, Math.min(end, bigList.length))
      state = advanceGrowingListSegments(state, text)
      // Fragments only append; earlier entries never change.
      state.fragments.forEach((fragment, i) => {
        if (i < seenFragments.length) {
          expect(fragment.text).toBe(seenFragments[i])
        } else {
          seenFragments.push(fragment.text)
        }
      })
      const joined = state.fragments.map((f) => f.text).join("")
      expect(joined).toBe(text.slice(0, state.committedLength))
      expect(joined + text.slice(state.committedLength)).toBe(text)
      // Every fragment starts at an item line and meets the size floor.
      for (const fragment of state.fragments) {
        expect(fragment.text).toMatch(/^\d+\. /)
        expect(fragment.text.length).toBeGreaterThanOrEqual(
          GROWING_LIST_SEGMENT_MIN_CHARS
        )
      }
      if (text.length === bigList.length) break
    }
    expect(state.fragments.length).toBeGreaterThan(1)
  })

  it("keeps loose-list fragments loose (each contains a blank line)", () => {
    const looseList = orderedList(200, "\n\n")
    let state = initialGrowingListSegmentsState()
    for (let end = 64; end < looseList.length + 64; end += 64) {
      state = advanceGrowingListSegments(
        state,
        looseList.slice(0, Math.min(end, looseList.length))
      )
    }
    expect(state.fragments.length).toBeGreaterThan(1)
    for (const fragment of state.fragments) {
      expect(fragment).toSatisfy((f: { text: string }) =>
        /\n[ \t]*\n/.test(f.text)
      )
    }
  })

  it("resets on a non-append text change", () => {
    let state = advanceGrowingListSegments(
      initialGrowingListSegmentsState(),
      bigList
    )
    expect(state.fragments.length).toBeGreaterThan(0)
    state = advanceGrowingListSegments(state, "1. rewritten\n2. differently\n")
    expect(state.fragments).toEqual([])
    expect(state.committedLength).toBe(0)
  })
})

describe("analyzeOpenFence", () => {
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
