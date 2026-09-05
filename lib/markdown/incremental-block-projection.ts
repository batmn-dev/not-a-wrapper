/**
 * Incremental Markdown block projection (ADR-0016).
 *
 * Pure, deterministic state transition that turns an accumulating Markdown
 * source into a stable list of block records without re-parsing the full
 * source on every append. The remark/unified pipeline used by the renderer
 * remains the single semantic authority: the fast path re-parses only the
 * mutable tail, and every uncertain case falls back to the same authoritative
 * full parse the legacy splitter performed (`splitMarkdownSource`, kept as
 * the reference implementation, reset path, and settlement oracle).
 *
 * Invariants:
 * - Ordinary append-only growth parses work proportional to the mutable
 *   region plus appended text, never total accumulated source.
 * - A block that has been marked stable NEVER changes text, offsets, type,
 *   or identity on a later append-only update.
 * - Settled output is equivalent to one authoritative full parse (verified
 *   at settlement; mismatches adopt the authoritative parse and are counted).
 * - No hidden module state: the transition is a pure function of
 *   (previous, source, streaming, identity), so React may call it from any
 *   render path (StrictMode double render, interrupted transitions) safely.
 *
 * Restart safety: a blank-line-preceded top-level block start is NOT by
 * itself a safe parser restart point for this remark stack — parser state
 * can survive a blank line. Two verified carriers: an indented code block
 * leaves "may still continue" state that changes how the NEXT block parses
 * (`\tcode\n\n2. two\n===` parses the tail as setext heading + paragraph in
 * context but as one list standalone), and a footnote definition absorbs
 * later indented content across blank lines. Both reach exactly one block
 * forward (any intervening block clears them — verified empirically).
 *
 * The fast path therefore re-parses the tail TOGETHER with the trailing
 * stable context blocks (at least `MIN_CONTEXT_BLOCKS`, extended backward
 * to a blank-line-preceded start) and requires every context block to
 * re-parse byte-identically. Context reproduction is checked on every
 * update: if appended text — through any state carrier, known or unknown —
 * changes how the context region parses, the update falls back to the
 * authoritative full parse with a counted `context-divergence` reason
 * instead of committing a divergent tail. Constructs whose effects reach
 * backward from appended text within the mutable window (paragraph/lazy
 * continuation, setext underlines, table delimiter rows, list merges,
 * closing fences) are re-parsed as part of the tail. Constructs with
 * document-wide RENDER semantics (reference link definitions) do not move
 * block boundaries, and the renderer already processes each block in
 * isolation, so per-block rendering is unchanged from the legacy splitter
 * by construction.
 */
import remarkGfm from "remark-gfm"
import remarkMath, { type Options as RemarkMathOptions } from "remark-math"
import remarkParse from "remark-parse"
import { unified } from "unified"
import {
  analyzeFenceOpener,
  analyzeOpenFence,
  blocksEquivalentModuloPartialTail,
  extendListBlockEnd,
  hasFenceCloser,
  terminalListFacts,
} from "./growing-block-tail"
import {
  canReuseParsedMarkdownWindow,
  retainParsedMarkdownBlock,
  type ParsedMarkdownBlock,
} from "./remark-parsed-block"

/**
 * Shared remark-math options for BOTH the block splitter and the per-block
 * renderer — the two must agree or block boundaries and rendering diverge.
 */
export const REMARK_MATH_OPTIONS = {
  singleDollarTextMath: false,
} satisfies RemarkMathOptions

/**
 * Bump whenever the parser pipeline or its options change: a projection
 * carried across a deploy boundary (or a test reusing state) must reset
 * rather than mix boundaries from two grammars.
 */
export const MARKDOWN_PARSER_VERSION = "remark-parse+gfm+math(no-single-dollar)#1"

const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath, REMARK_MATH_OPTIONS)

/**
 * How many trailing blocks stay mutable during streaming. The terminal block
 * is where growth lands; the immediately preceding block is kept mutable as
 * the conservative ambiguity window the plan requires (setext underlines,
 * table delimiter rows, and list merges all reach at most one block back).
 * The window is NOT the correctness mechanism — context reproduction below
 * is; the window only bounds how much re-renders churn.
 */
export const MUTABLE_BLOCK_WINDOW = 2

/**
 * How many trailing STABLE blocks are re-parsed with the tail as verified
 * context. Both known cross-blank-line state carriers reach one block
 * forward; two blocks gives one block of margin, and the byte-identical
 * reproduction check (not this constant) is what correctness rests on.
 */
export const MIN_CONTEXT_BLOCKS = 2

/**
 * Bound on how far the context start may walk backward looking for a
 * blank-line-preceded block start before giving up and taking the
 * authoritative full parse instead.
 */
const MAX_CONTEXT_WALK = 8

export type MarkdownProjectionBlock = {
  /** Exact source slice for this block (what the per-block renderer parses). */
  text: string
  /** Identity-stable render key: `b<n>` from the monotonic identity counter. */
  id: string
  /** mdast node type (`paragraph`, `heading`, `code`, `table`, `list`, …). */
  nodeType: string
  startOffset: number
  endOffset: number
  parsedBlock?: ParsedMarkdownBlock
}

export type MarkdownProjectionState = {
  source: string
  blocks: MarkdownProjectionBlock[]
  /** Blocks before this index are frozen: text, offsets, and id never change. */
  stableCount: number
  /** Safe restart offset — the fast path re-parses `source.slice(here)`. */
  mutableStartOffset: number
  /** Next identity number; monotonic within a projection lineage. */
  nextBlockIdentity: number
  parserVersion: string
  /** Message identity the projection belongs to; a change forces a reset. */
  identity: string
  /** True once settled by a `streaming: false` authoritative parse. */
  settled: boolean
}

export type MarkdownProjectionResetReason =
  | "initial"
  | "identity-changed"
  | "parser-version-changed"
  | "source-shrunk"
  | "source-diverged"

export type MarkdownProjectionFallbackReason =
  "no-safe-restart-boundary" | "tail-misaligned" | "context-divergence"

export type MarkdownProjectionResult = {
  state: MarkdownProjectionState
  /** True when every previous block identity was discarded (full reset). */
  reset: boolean
  resetReason: MarkdownProjectionResetReason | null
  /** Set when an append-only update could not use the incremental tail path. */
  fallbackReason: MarkdownProjectionFallbackReason | null
  /**
   * Set when the settlement verification found the incremental projection
   * inequivalent to the authoritative parse (authoritative output is used).
   */
  settleMismatch: boolean
  parsedCharacters: number
  /** Blocks that kept their identity from the previous state. */
  reusedBlockCount: number
  /** Blocks that are new or whose text changed in this transition. */
  changedBlockCount: number
}

type RawBlock = {
  text: string
  nodeType: string
  startOffset: number
  endOffset: number
  parsedBlock?: ParsedMarkdownBlock
}

/**
 * Authoritative full-source splitter — the legacy `parseMarkdownIntoBlocks`
 * behavior (same parser, same skip of position-less nodes). Kept exported as
 * the reference implementation for resets, settlement, fallbacks, tests, and
 * benchmarks.
 */
export function splitMarkdownSource(source: string): RawBlock[] {
  return splitWithProcessor(source, 0)
}

function splitWithProcessor(
  text: string,
  offsetBase: number,
  retainSyntax = false
): RawBlock[] {
  const tree = markdownProcessor.parse(text)
  const reusableWindow = retainSyntax && canReuseParsedMarkdownWindow(tree)
  const blocks: RawBlock[] = []
  for (const [index, node] of tree.children.entries()) {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (typeof start !== "number" || typeof end !== "number") {
      continue
    }
    const source = text.slice(start, end)
    blocks.push({
      text: source,
      nodeType: node.type,
      startOffset: offsetBase + start,
      endOffset: offsetBase + end,
      ...(retainSyntax
        ? {
            parsedBlock: reusableWindow
              ? retainParsedMarkdownBlock(
                  node,
                  source,
                  tree.children[index - 1]
                )
              : undefined,
          }
        : {}),
    })
  }
  return blocks
}

/**
 * True when `offset` is a safe parser restart point: the start of the source,
 * or preceded by a completed line plus a blank line (spaces/tabs only), with
 * CRLF tolerated. At such a point the block parser holds no carried state.
 */
export function isSafeRestartBoundary(source: string, offset: number): boolean {
  if (offset === 0) return true
  let index = offset - 1
  // The character immediately before a block start after inter-block trivia
  // is always a newline (remark block positions begin at a line start); any
  // trailing blank-line whitespace belongs to the gap we are scanning.
  const consumeLineBreak = (): boolean => {
    if (index >= 0 && source[index] === "\n") {
      index--
      if (index >= 0 && source[index] === "\r") index--
      return true
    }
    return false
  }
  const consumeBlankInline = () => {
    while (index >= 0 && (source[index] === " " || source[index] === "\t")) {
      index--
    }
  }
  // Blocks can be separated by MULTIPLE blank lines; require at least
  // newline + one blank line, scanning: [\n] ([ \t]* [\n])+ before offset.
  if (!consumeLineBreak()) return false
  let blankLines = 0
  for (;;) {
    consumeBlankInline()
    if (index < 0) {
      // Ran off the start of the document through blank space — safe.
      return true
    }
    if (!consumeLineBreak()) break
    blankLines++
  }
  return blankLines >= 1
}

function assignIdentities(
  raw: RawBlock[],
  firstIdentity: number
): { blocks: MarkdownProjectionBlock[]; nextBlockIdentity: number } {
  let next = firstIdentity
  const blocks = raw.map((block) => ({
    ...block,
    id: `b${next++}`,
  }))
  return { blocks, nextBlockIdentity: next }
}

/**
 * Reconcile a freshly parsed block list against the previous one, reusing an
 * identity when the block's start offset and node type are continuous with
 * the previous block at the same position. Growth (end offset / text change)
 * keeps identity; a block that splits, merges, or changes type gets a new
 * one. `previous` and `parsed` are aligned by order.
 */
function reconcileIdentities(
  previous: readonly MarkdownProjectionBlock[],
  parsed: readonly RawBlock[],
  firstIdentity: number
): {
  blocks: MarkdownProjectionBlock[]
  nextBlockIdentity: number
  reusedBlockCount: number
  changedBlockCount: number
} {
  let next = firstIdentity
  let reused = 0
  let changed = 0
  const blocks = parsed.map((block, index) => {
    const before = previous[index]
    if (
      before &&
      before.startOffset === block.startOffset &&
      before.nodeType === block.nodeType
    ) {
      if (before.text !== block.text || before.endOffset !== block.endOffset) {
        changed++
      } else {
        reused++
        return before
      }
      return { ...block, id: before.id }
    }
    changed++
    return { ...block, id: `b${next++}` }
  })
  return {
    blocks,
    nextBlockIdentity: next,
    reusedBlockCount: reused,
    changedBlockCount: changed,
  }
}

/**
 * Choose the stable prefix and the safe restart offset for a streaming state.
 * The window rule wants everything but the last `MUTABLE_BLOCK_WINDOW` blocks
 * stable, but stability never regresses below `minStableCount`, only ever
 * advances to a blank-line-safe boundary, and the restart offset never moves
 * backward past `floorOffset` (a boundary already proven safe).
 */
function chooseStableBoundary(
  source: string,
  blocks: readonly MarkdownProjectionBlock[],
  minStableCount: number,
  floorOffset: number
): { stableCount: number; mutableStartOffset: number } {
  let candidate = Math.max(minStableCount, blocks.length - MUTABLE_BLOCK_WINDOW)
  while (candidate > minStableCount) {
    const start = blocks[candidate]?.startOffset
    if (
      start !== undefined &&
      start >= floorOffset &&
      isSafeRestartBoundary(source, start)
    ) {
      return { stableCount: candidate, mutableStartOffset: start }
    }
    candidate--
  }
  // Could not advance past the floor: keep the already-proven-safe restart
  // offset (0 for a fresh parse), leaving a larger-than-window mutable tail.
  return { stableCount: minStableCount, mutableStartOffset: floorOffset }
}

function blockListsEquivalent(
  a: readonly MarkdownProjectionBlock[],
  b: readonly RawBlock[]
): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const left = a[i]!
    const right = b[i]!
    if (
      left.startOffset !== right.startOffset ||
      left.endOffset !== right.endOffset ||
      left.nodeType !== right.nodeType ||
      left.text !== right.text
    ) {
      return false
    }
  }
  return true
}

function fullParseResult(args: {
  source: string
  streaming: boolean
  identity: string
  previous: MarkdownProjectionState | null
  reset: boolean
  resetReason: MarkdownProjectionResetReason | null
  fallbackReason: MarkdownProjectionFallbackReason | null
}): MarkdownProjectionResult {
  const { source, streaming, identity, previous } = args
  const raw = splitWithProcessor(source, 0, true)

  let blocks: MarkdownProjectionBlock[]
  let nextBlockIdentity: number
  let reusedBlockCount = 0
  let changedBlockCount: number

  if (args.reset || previous === null) {
    // Full reset: every identity is new so downstream memo/DOM state from
    // the abandoned lineage cannot leak into the new one.
    const assigned = assignIdentities(raw, previous?.nextBlockIdentity ?? 0)
    blocks = assigned.blocks
    nextBlockIdentity = assigned.nextBlockIdentity
    changedBlockCount = blocks.length
  } else {
    const reconciled = reconcileIdentities(
      previous.blocks,
      raw,
      previous.nextBlockIdentity
    )
    blocks = reconciled.blocks
    nextBlockIdentity = reconciled.nextBlockIdentity
    reusedBlockCount = reconciled.reusedBlockCount
    changedBlockCount = reconciled.changedBlockCount
  }

  const boundary = streaming
    ? chooseStableBoundary(source, blocks, 0, 0)
    : { stableCount: blocks.length, mutableStartOffset: source.length }

  return {
    state: {
      source,
      blocks,
      stableCount: boundary.stableCount,
      mutableStartOffset: boundary.mutableStartOffset,
      nextBlockIdentity,
      parserVersion: MARKDOWN_PARSER_VERSION,
      identity,
      settled: !streaming,
    },
    reset: args.reset,
    resetReason: args.resetReason,
    fallbackReason: args.fallbackReason,
    settleMismatch: false,
    parsedCharacters: source.length,
    reusedBlockCount,
    changedBlockCount,
  }
}

/**
 * Advance the projection for a new (source, streaming) observation.
 *
 * - No previous / identity change / parser change / non-prefix source:
 *   authoritative full parse (reset — all identities new).
 * - Append-only growth while streaming: re-parse only the mutable tail from
 *   the safe restart offset; stable blocks are carried over untouched.
 * - `streaming: false`: settlement — one authoritative full parse, identity
 *   reconciliation, equivalence verification, everything marked stable.
 */
export function advanceMarkdownProjection(args: {
  previous: MarkdownProjectionState | null
  source: string
  streaming: boolean
  identity: string
}): MarkdownProjectionResult {
  const { previous, source, streaming, identity } = args

  if (previous === null) {
    return fullParseResult({
      source,
      streaming,
      identity,
      previous,
      reset: true,
      resetReason: "initial",
      fallbackReason: null,
    })
  }
  if (previous.identity !== identity) {
    return fullParseResult({
      source,
      streaming,
      identity,
      previous,
      reset: true,
      resetReason: "identity-changed",
      fallbackReason: null,
    })
  }
  if (previous.parserVersion !== MARKDOWN_PARSER_VERSION) {
    return fullParseResult({
      source,
      streaming,
      identity,
      previous,
      reset: true,
      resetReason: "parser-version-changed",
      fallbackReason: null,
    })
  }
  const isPrefix =
    source.length >= previous.source.length && source.startsWith(previous.source)
  if (!isPrefix) {
    return fullParseResult({
      source,
      streaming,
      identity,
      previous,
      reset: true,
      resetReason:
        source.length < previous.source.length &&
        previous.source.startsWith(source)
          ? "source-shrunk"
          : "source-diverged",
      fallbackReason: null,
    })
  }

  if (!streaming) {
    if (previous.settled && previous.source === source) {
      // Already settled on this exact source: nothing to do.
      return {
        state: previous,
        reset: false,
        resetReason: null,
        fallbackReason: null,
        settleMismatch: false,
        parsedCharacters: 0,
        reusedBlockCount: previous.blocks.length,
        changedBlockCount: 0,
      }
    }
    const settled = fullParseResult({
      source,
      streaming: false,
      identity,
      previous,
      reset: false,
      resetReason: null,
      fallbackReason: null,
    })
    // Settlement verification: when the incremental projection was current
    // for this exact source, the authoritative parse must agree with it —
    // exactly, or modulo the trailing-partial-line partition, which the
    // terminal line-extension fast path holds inside the growing block while
    // the parser repartitions it char by char (same bytes, same rendering).
    const settleMismatch =
      previous.source === source &&
      !blockListsEquivalent(previous.blocks, settled.state.blocks) &&
      !blocksEquivalentModuloPartialTail(
        previous.blocks,
        settled.state.blocks,
        source
      )
    return { ...settled, settleMismatch }
  }

  if (previous.source === source && !previous.settled) {
    return {
      state: previous,
      reset: false,
      resetReason: null,
      fallbackReason: null,
      settleMismatch: false,
      parsedCharacters: 0,
      reusedBlockCount: previous.blocks.length,
      changedBlockCount: 0,
    }
  }

  // A settled projection observed streaming again on prefix growth
  // (continuation after an approval pause, resumed run): one identity-
  // preserving full parse re-establishes the streaming window. Rare, so the
  // full-parse cost is irrelevant and simpler than reopening settled state.
  if (previous.settled) {
    return fullParseResult({
      source,
      streaming,
      identity,
      previous,
      reset: false,
      resetReason: null,
      fallbackReason: null,
    })
  }

  // Terminal-block line extension.
  // A growing single-block shape (a list without blank-line separators, an
  // open code fence) pins the safe restart boundary at the block's start, so
  // the tail parse below would re-parse the WHOLE block on every append —
  // per-update cost growing with response length. When appended lines provably
  // continue the terminal block, the
  // block record extends by a line scan with NO parse at all; any line the
  // scan cannot prove falls through to the authoritative paths below, and
  // settlement's full-parse equivalence check remains the safety net.
  const extended = tryExtendTerminalBlock(previous, source)
  if (extended) return extended

  // Append-only tail parse.
  const stablePrefix = previous.blocks.filter(
    (block) => block.endOffset <= previous.mutableStartOffset
  )
  if (stablePrefix.length !== previous.stableCount) {
    // Stable bookkeeping does not line up with the restart offset — treat as
    // unprovable and take the authoritative path.
    return fullParseResult({
      source,
      streaming,
      identity,
      previous,
      reset: false,
      resetReason: null,
      fallbackReason: "tail-misaligned",
    })
  }

  // Choose where the mini-parse starts: at least MIN_CONTEXT_BLOCKS stable
  // blocks before the mutable region, extended backward until the start is
  // blank-line preceded (or the document start). The context blocks are
  // re-parsed alongside the tail and must reproduce EXACTLY — that check,
  // not the boundary choice, carries correctness.
  let contextStartIndex = Math.max(0, previous.stableCount - MIN_CONTEXT_BLOCKS)
  let walked = 0
  while (contextStartIndex > 0) {
    const start = previous.blocks[contextStartIndex]?.startOffset
    if (start !== undefined && isSafeRestartBoundary(source, start)) break
    contextStartIndex--
    walked++
    if (walked > MAX_CONTEXT_WALK) {
      return fullParseResult({
        source,
        streaming,
        identity,
        previous,
        reset: false,
        resetReason: null,
        fallbackReason: "no-safe-restart-boundary",
      })
    }
  }
  const parseOffset =
    contextStartIndex === 0
      ? 0
      : (previous.blocks[contextStartIndex]?.startOffset ?? 0)
  const contextBlocks = previous.blocks.slice(
    contextStartIndex,
    previous.stableCount
  )

  const parsed = splitWithProcessor(
    source.slice(parseOffset),
    parseOffset,
    true
  )

  // Context reproduction check: every context block must come back with the
  // same type, offsets, and text. A mismatch means parser state beyond the
  // context window influenced this region (or appended text reached further
  // back than the mutable window) — take the authoritative parse instead of
  // committing a divergent tail.
  let contextReproduced = parsed.length >= contextBlocks.length
  if (contextReproduced) {
    for (let i = 0; i < contextBlocks.length; i++) {
      const before = contextBlocks[i]!
      const after = parsed[i]!
      if (
        before.startOffset !== after.startOffset ||
        before.endOffset !== after.endOffset ||
        before.nodeType !== after.nodeType ||
        before.text !== after.text
      ) {
        contextReproduced = false
        break
      }
    }
  }
  if (!contextReproduced) {
    return fullParseResult({
      source,
      streaming,
      identity,
      previous,
      reset: false,
      resetReason: null,
      fallbackReason: "context-divergence",
    })
  }

  const tailRaw = parsed.slice(contextBlocks.length)

  // The previous mutable blocks, aligned positionally with the re-parsed
  // tail for identity reconciliation.
  const previousMutable = previous.blocks.slice(stablePrefix.length)
  const reconciled = reconcileIdentities(
    previousMutable,
    tailRaw,
    previous.nextBlockIdentity
  )

  const blocks = [...stablePrefix, ...reconciled.blocks]
  const boundary = chooseStableBoundary(
    source,
    blocks,
    stablePrefix.length,
    previous.mutableStartOffset
  )

  return {
    state: {
      source,
      blocks,
      stableCount: boundary.stableCount,
      mutableStartOffset: boundary.mutableStartOffset,
      nextBlockIdentity: reconciled.nextBlockIdentity,
      parserVersion: MARKDOWN_PARSER_VERSION,
      identity,
      settled: false,
    },
    reset: false,
    resetReason: null,
    fallbackReason: null,
    settleMismatch: false,
    parsedCharacters: source.length - parseOffset,
    reusedBlockCount: stablePrefix.length + reconciled.reusedBlockCount,
    changedBlockCount: reconciled.changedBlockCount,
  }
}

/**
 * Zero-parse extension of a growing terminal `list`/`code` block (see the
 * call site above). Returns null whenever anything is not provably a
 * continuation — the caller's parse paths then own the update.
 */
function tryExtendTerminalBlock(
  previous: MarkdownProjectionState,
  source: string
): MarkdownProjectionResult | null {
  const terminalIndex = previous.blocks.length - 1
  if (terminalIndex < 0 || terminalIndex < previous.stableCount) return null
  const terminal = previous.blocks[terminalIndex]!

  let newEndOffset: number | null = null
  if (terminal.nodeType === "code") {
    // The prior projection already proved that this terminal code block is an
    // open fence. Re-read only its bounded opener line for immutable facts;
    // scanning the whole accumulated interior here would make small appends
    // quadratic over the life of a long fence.
    const fence = analyzeFenceOpener(terminal.text)
    if (!fence) return null
    // Re-scan from the start of the block's last line: the previously
    // unterminated line may have completed into a closer.
    const lastLineStart = source.lastIndexOf("\n", terminal.endOffset - 1) + 1
    if (
      hasFenceCloser(source, fence, Math.max(lastLineStart, terminal.startOffset))
    ) {
      return null
    }
    // An open fence consumes everything to the end of the source (trailing
    // newline and blank lines included — remark's observed convention).
    newEndOffset = source.length
  } else if (terminal.nodeType === "list") {
    const facts = terminalListFacts(source, terminal)
    if (!facts) return null
    newEndOffset = extendListBlockEnd({
      source,
      blockStartOffset: terminal.startOffset,
      blockEndOffset: terminal.endOffset,
      family: facts.family,
      lastLineAfterBlank: facts.lastLineAfterBlank,
    })
    if (newEndOffset === null) return null
  } else {
    return null
  }

  const changed = newEndOffset !== terminal.endOffset
  const blocks = changed
    ? [
        ...previous.blocks.slice(0, terminalIndex),
        {
          ...terminal,
          endOffset: newEndOffset,
          text: source.slice(terminal.startOffset, newEndOffset),
          parsedBlock: undefined,
        },
      ]
    : previous.blocks

  return {
    state: {
      ...previous,
      source,
      blocks,
    },
    reset: false,
    resetReason: null,
    fallbackReason: null,
    settleMismatch: false,
    parsedCharacters: 0,
    reusedBlockCount: previous.blocks.length - (changed ? 1 : 0),
    changedBlockCount: changed ? 1 : 0,
  }
}
