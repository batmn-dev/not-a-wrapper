/**
 * Incremental Markdown projection tests (ADR-0016).
 *
 * The load-bearing assertion is the streaming equivalence harness: for every
 * corpus fixture, at EVERY streamed prefix (exhaustive char-by-char plus
 * seeded random chunkings), the incremental projection's block records must
 * match an authoritative full parse of the same prefix, stable blocks must
 * be frozen, and settlement must verify clean. "Match" is exact — text,
 * node type, and offsets — at every line-terminated prefix; within a
 * TRAILING PARTIAL LINE the two may partition differently (the terminal
 * line-extension fast path keeps the partial inside the growing block, while
 * remark itself repartitions such tails char by char — e.g. a lone `-` is
 * briefly its own paragraph, then merges back into the list at `- x`), so
 * mid-line prefixes assert equality of the line-clipped views plus identical
 * total source coverage. Rendering is partition-invariant over the same
 * bytes (each block's text is re-parsed by the renderer), and settlement
 * stays byte-exact. Seeds are embedded in failure labels for reproduction.
 */
import {
  buildLongMarkdownPayload,
  buildManyShortBlocksPayload,
} from "../../benchmarks/chat-performance/fixtures"
import { describe, expect, it } from "vitest"
import {
  advanceMarkdownProjection,
  isSafeRestartBoundary,
  MARKDOWN_PARSER_VERSION,
  splitMarkdownSource,
  type MarkdownProjectionBlock,
  type MarkdownProjectionState,
} from "./incremental-block-projection"
import {
  EQUIVALENCE_FIXTURES,
  everyPrefixOffsets,
  seededPrefixOffsets,
} from "./markdown-equivalence-corpus"
import {
  blocksCoverageEnd,
  lineClippedBlockView,
  type BlockView,
} from "./growing-block-tail"

const IDENTITY = "message-under-test"

function rawView(blocks: readonly MarkdownProjectionBlock[]) {
  return blocks.map(({ text, nodeType, startOffset, endOffset }) => ({
    text,
    nodeType,
    startOffset,
    endOffset,
  }))
}

function expectValidPartialLineTail(
  blocks: readonly BlockView[],
  source: string,
  label: string
) {
  const partialLineStart = source.lastIndexOf("\n") + 1
  const tailBlocks = blocks.filter(
    (block) => block.endOffset > partialLineStart
  )
  for (let i = 0; i < tailBlocks.length; i++) {
    const block = tailBlocks[i]!
    expect(block.text, `${label} block ${i} text`).toBe(
      source.slice(block.startOffset, block.endOffset)
    )
    if (i > 0) {
      expect(
        block.startOffset,
        `${label} block ${i} overlaps prior block`
      ).toBeGreaterThanOrEqual(tailBlocks[i - 1]!.endOffset)
    }
  }
}

/**
 * Stream `source` through the projection at the given prefix offsets,
 * asserting full-parse equivalence, frozen stable blocks, and unique ids at
 * every step, then settle and verify. Returns aggregate parse work.
 */
function streamAndVerify(
  source: string,
  offsets: readonly number[],
  label: string
) {
  let state: MarkdownProjectionState | null = null
  let totalParsedCharacters = 0
  let fallbacks = 0
  for (const offset of offsets) {
    const prefix = source.slice(0, offset)
    const result = advanceMarkdownProjection({
      previous: state,
      source: prefix,
      streaming: true,
      identity: IDENTITY,
    })

    const reference = splitMarkdownSource(prefix)
    if (prefix.endsWith("\n") || prefix.length === 0) {
      expect(rawView(result.state.blocks), `${label} @${offset}`).toEqual(
        reference
      )
    } else {
      // Mid-line prefix: exact agreement up to the last line boundary,
      // identical coverage of the partial-line tail.
      expect(
        lineClippedBlockView(result.state.blocks, prefix),
        `${label} @${offset} (line-clipped)`
      ).toEqual(lineClippedBlockView(reference, prefix))
      expect(
        blocksCoverageEnd(result.state.blocks),
        `${label} @${offset} (coverage)`
      ).toBe(blocksCoverageEnd(reference))
      expectValidPartialLineTail(
        result.state.blocks,
        prefix,
        `${label} @${offset} (projection tail)`
      )
      expectValidPartialLineTail(
        reference,
        prefix,
        `${label} @${offset} (reference tail)`
      )
    }

    if (state) {
      expect(result.reset, `${label} unexpected reset @${offset}`).toBe(false)
      for (let i = 0; i < state.stableCount; i++) {
        expect(
          result.state.blocks[i],
          `${label} stable block ${i} mutated @${offset}`
        ).toEqual(state.blocks[i])
      }
    }

    const ids = new Set(result.state.blocks.map((block) => block.id))
    expect(ids.size, `${label} duplicate ids @${offset}`).toBe(
      result.state.blocks.length
    )

    if (result.fallbackReason !== null) fallbacks++
    totalParsedCharacters += result.parsedCharacters
    state = result.state
  }

  const settled = advanceMarkdownProjection({
    previous: state,
    source,
    streaming: false,
    identity: IDENTITY,
  })
  expect(settled.settleMismatch, `${label} settle mismatch`).toBe(false)
  expect(rawView(settled.state.blocks), `${label} settled`).toEqual(
    splitMarkdownSource(source)
  )
  expect(settled.state.stableCount).toBe(settled.state.blocks.length)
  expect(settled.state.settled).toBe(true)

  // Settlement keeps identities for positionally continuous blocks: the
  // terminal block flips to stable WITHOUT being re-keyed.
  if (state) {
    for (let i = 0; i < settled.state.blocks.length; i++) {
      const before = state.blocks[i]
      const after = settled.state.blocks[i]!
      if (
        before &&
        before.startOffset === after.startOffset &&
        before.nodeType === after.nodeType
      ) {
        expect(after.id, `${label} settled re-key of block ${i}`).toBe(
          before.id
        )
      }
    }
  }

  return { totalParsedCharacters, fallbacks, settled: settled.state }
}

describe("streaming equivalence corpus", () => {
  for (const fixture of EQUIVALENCE_FIXTURES) {
    it(`matches the authoritative parser at every prefix: ${fixture.name}`, () => {
      if (fixture.charByChar) {
        streamAndVerify(
          fixture.source,
          everyPrefixOffsets(fixture.source.length),
          `${fixture.name}[char-by-char]`
        )
      }
      for (let seed = 1; seed <= 8; seed++) {
        streamAndVerify(
          fixture.source,
          seededPrefixOffsets(fixture.source.length, seed),
          `${fixture.name}[seed=${seed}]`
        )
      }
    })
  }

  // Heavy by design (4 seeded replays over the whole corpus); shared CI
  // runners exceed the 5 s default. The bound is a ceiling, not a target.
  it("streams the concatenated corpus as one long document (seeded chunks)", { timeout: 60_000 }, () => {
    const combined = EQUIVALENCE_FIXTURES.filter(
      // CRLF fixture excluded: concatenating mixed EOL styles creates
      // \r\n/\n islands no real stream produces; it has its own fixture.
      (fixture) => fixture.name !== "crlf-endings"
    )
      .map((fixture) => fixture.source)
      .join("\n\n")
    for (let seed = 101; seed <= 104; seed++) {
      streamAndVerify(
        combined,
        seededPrefixOffsets(combined.length, seed, 64),
        `combined[seed=${seed}]`
      )
    }
  })
})

describe("append-only work proportionality (§6 gate)", () => {
  it("parses only the mutable tail on ~100 KB append-only growth", () => {
    const base = buildLongMarkdownPayload()
    let state: MarkdownProjectionState | null = null
    // Prime with the full payload (initial parse is full-source by design).
    state = advanceMarkdownProjection({
      previous: null,
      source: base,
      streaming: true,
      identity: IDENTITY,
    }).state

    let tail = ""
    for (let i = 0; i < 20; i++) {
      tail += ` word${i}`
      const result = advanceMarkdownProjection({
        previous: state,
        source: base + tail,
        streaming: true,
        identity: IDENTITY,
      })
      expect(result.fallbackReason).toBeNull()
      expect(result.reset).toBe(false)
      // Work must track the mutable region (last blocks + appended chars),
      // not the ~100 KB accumulated source: three orders of magnitude.
      expect(result.parsedCharacters).toBeLessThan(1024)
      state = result.state
    }

    const settledReference = splitMarkdownSource(base + tail)
    expect(rawView(state.blocks)).toEqual(settledReference)
  })

  it("keeps per-update reconciliation bounded with 400 completed blocks", () => {
    const base = buildManyShortBlocksPayload()
    let state = advanceMarkdownProjection({
      previous: null,
      source: base,
      streaming: true,
      identity: IDENTITY,
    }).state
    const result = advanceMarkdownProjection({
      previous: state,
      source: base + " grows",
      streaming: true,
      identity: IDENTITY,
    })
    expect(result.fallbackReason).toBeNull()
    expect(result.parsedCharacters).toBeLessThan(256)
    // All stable blocks reused; only the mutable window changed.
    expect(result.changedBlockCount).toBeLessThanOrEqual(2)
  })
})

describe("resets and lifecycle", () => {
  const start = "First paragraph.\n\nSecond paragraph grows"

  function primed() {
    return advanceMarkdownProjection({
      previous: null,
      source: start,
      streaming: true,
      identity: IDENTITY,
    }).state
  }

  it("same source and streaming state is a no-op returning the same state", () => {
    const state = primed()
    const again = advanceMarkdownProjection({
      previous: state,
      source: start,
      streaming: true,
      identity: IDENTITY,
    })
    expect(again.state).toBe(state)
    expect(again.parsedCharacters).toBe(0)
  })

  it("is idempotent for React StrictMode double-invocation", () => {
    const state = primed()
    const next = start + " more words"
    const first = advanceMarkdownProjection({
      previous: state,
      source: next,
      streaming: true,
      identity: IDENTITY,
    })
    const second = advanceMarkdownProjection({
      previous: state,
      source: next,
      streaming: true,
      identity: IDENTITY,
    })
    expect(second).toEqual(first)
  })

  it("resets with all-new identities on identity change", () => {
    const state = primed()
    const result = advanceMarkdownProjection({
      previous: state,
      source: start,
      streaming: true,
      identity: "different-message",
    })
    expect(result.reset).toBe(true)
    expect(result.resetReason).toBe("identity-changed")
    const oldIds = new Set(state.blocks.map((block) => block.id))
    for (const block of result.state.blocks) {
      expect(oldIds.has(block.id)).toBe(false)
    }
  })

  it("resets on shrinkage and on divergence with distinct reasons", () => {
    const state = primed()
    const shrunk = advanceMarkdownProjection({
      previous: state,
      source: start.slice(0, 10),
      streaming: true,
      identity: IDENTITY,
    })
    expect(shrunk.resetReason).toBe("source-shrunk")

    const diverged = advanceMarkdownProjection({
      previous: state,
      source: "Completely different content.",
      streaming: true,
      identity: IDENTITY,
    })
    expect(diverged.resetReason).toBe("source-diverged")
  })

  it("resets when the parser version does not match", () => {
    const state = { ...primed(), parserVersion: "older-version" }
    const result = advanceMarkdownProjection({
      previous: state,
      source: start + " more",
      streaming: true,
      identity: IDENTITY,
    })
    expect(result.reset).toBe(true)
    expect(result.resetReason).toBe("parser-version-changed")
    expect(result.state.parserVersion).toBe(MARKDOWN_PARSER_VERSION)
  })

  it("settles once and re-enters streaming on continuation without a reset", () => {
    const state = primed()
    const settled = advanceMarkdownProjection({
      previous: state,
      source: start,
      streaming: false,
      identity: IDENTITY,
    })
    expect(settled.state.settled).toBe(true)
    expect(settled.settleMismatch).toBe(false)

    // Settled + unchanged: pure no-op.
    const again = advanceMarkdownProjection({
      previous: settled.state,
      source: start,
      streaming: false,
      identity: IDENTITY,
    })
    expect(again.state).toBe(settled.state)

    // Continuation (approval resume): prefix growth back into streaming —
    // identity-preserving, no reset, and equivalent to the full parse.
    const continued = advanceMarkdownProjection({
      previous: settled.state,
      source: start + " and continues after approval.\n\nNew block.",
      streaming: true,
      identity: IDENTITY,
    })
    expect(continued.reset).toBe(false)
    expect(continued.state.settled).toBe(false)
    expect(rawView(continued.state.blocks)).toEqual(
      splitMarkdownSource(start + " and continues after approval.\n\nNew block.")
    )
    // The first block's identity survives settlement and continuation.
    expect(continued.state.blocks[0]?.id).toBe(state.blocks[0]?.id)
  })

  it("falls back with a counted reason instead of trusting corrupted stable bookkeeping", () => {
    const state = primed()
    const sabotaged: MarkdownProjectionState = {
      ...state,
      // Claim one stable block but point the restart offset mid-paragraph:
      // the stable-prefix check cannot line up.
      stableCount: 1,
      mutableStartOffset: 3,
    }
    const result = advanceMarkdownProjection({
      previous: sabotaged,
      source: start + " more",
      streaming: true,
      identity: IDENTITY,
    })
    expect(result.fallbackReason).toBe("tail-misaligned")
    expect(rawView(result.state.blocks)).toEqual(
      splitMarkdownSource(start + " more")
    )
  })

  it("live-corrects the review's parser-state counterexample without divergence", () => {
    // This parses as heading + paragraph in context but as one list standalone.
    // The context-verified tail parse must match the authoritative parser at
    // every step — never commit the standalone (list) reading.
    const before = "\tindented\n\n2. two\n===\n="
    const after = before + "="
    const state = advanceMarkdownProjection({
      previous: null,
      source: before,
      streaming: true,
      identity: IDENTITY,
    }).state
    const result = advanceMarkdownProjection({
      previous: state,
      source: after,
      streaming: true,
      identity: IDENTITY,
    })
    expect(rawView(result.state.blocks)).toEqual(splitMarkdownSource(after))
    expect(
      result.state.blocks.map((block) => block.nodeType)
    ).toEqual(["code", "heading", "paragraph"])
  })
})

describe("isSafeRestartBoundary", () => {
  it("accepts document start, LF and CRLF blank lines, and blank lines with spaces/tabs", () => {
    expect(isSafeRestartBoundary("anything", 0)).toBe(true)
    expect(isSafeRestartBoundary("a\n\nb", 3)).toBe(true)
    expect(isSafeRestartBoundary("a\r\n\r\nb", 5)).toBe(true)
    expect(isSafeRestartBoundary("a\n  \nb", 5)).toBe(true)
    expect(isSafeRestartBoundary("a\n\t\nb", 4)).toBe(true)
    expect(isSafeRestartBoundary("a\n\n\n\nb", 5)).toBe(true)
    expect(isSafeRestartBoundary("\nb", 1)).toBe(true)
  })

  it("rejects mid-line offsets and single newlines", () => {
    expect(isSafeRestartBoundary("a\nb", 2)).toBe(false)
    expect(isSafeRestartBoundary("ab", 1)).toBe(false)
    expect(isSafeRestartBoundary("a\r\nb", 3)).toBe(false)
  })
})
