/**
 * Growing-block tail helpers (streaming investigation 2026-07-28, fix 1).
 *
 * Single-block content — a list without blank-line separators, an open code
 * fence — never presents a blank-line-preceded block start, so the block
 * projection's stable boundary stays pinned at the block's start and every
 * streaming update re-parses AND re-renders the entire growing block:
 * per-update cost grows with response length (the measured "smooth at first,
 * chunky later" degradation). This module bounds both halves:
 *
 *  - PARSE: `tryExtendTerminalBlock` lets the projection extend a growing
 *    list/fence block by classifying appended LINES (a scan, not a parse).
 *    Classification is conservative: any line it cannot prove to continue
 *    the block bails to the projection's existing authoritative paths, and
 *    settlement's full-parse equivalence check remains the safety net.
 *  - RENDER: `advanceGrowingListSegments` maintains frozen, append-only
 *    fragments of a growing list so the component memoizes everything but a
 *    bounded suffix; `analyzeOpenFence` lets the component render a growing
 *    fence directly (no per-update Markdown re-parse of the interior).
 *
 * Partition-vs-content invariant: block records only place BOUNDARIES; the
 * renderer re-parses each block's text, so a transiently optimistic boundary
 * (a partial line included in the list block while it could still become
 * anything) renders identically to the authoritative partition as long as
 * text coverage matches. Complete lines are therefore classified strictly,
 * while the trailing partial line is included optimistically and
 * re-classified once terminated.
 */

import type { MarkdownProjectionBlock } from "./incremental-block-projection"

/** Segment activation and frozen-fragment sizing for growing lists. */
export const GROWING_LIST_SEGMENT_THRESHOLD = 2048
export const GROWING_LIST_SEGMENT_MIN_CHARS = 2048

export type ListFamily = {
  kind: "ordered" | "bullet"
  /** `.`/`)` for ordered, the literal marker char for bullets — a marker
   * change starts a NEW list per CommonMark, so it must bail. */
  marker: string
}

const ORDERED_ITEM_RE = /^ {0,3}(\d{1,9})([.)])[ \t]+\S/
const BULLET_ITEM_RE = /^ {0,3}([-*+])[ \t]+\S/
const THEMATIC_BREAK_RE = /^ {0,3}([-*_])([ \t]*\1){2,}[ \t]*$/
/** Complete-line lazy continuation whitelist: indented continuation, or a
 * paragraph-continuation line starting with clearly inert prose characters.
 * Everything else (fences, headings, quotes, setext/thematic candidates,
 * tables, html) is ambiguous and bails to the parser. */
const LAZY_SAFE_RE = /^(?:[ \t]|[A-Za-z0-9"'‘’“”([{])/

export function listFamilyOf(blockText: string): ListFamily | null {
  const ordered = ORDERED_ITEM_RE.exec(blockText)
  if (ordered) return { kind: "ordered", marker: ordered[2] }
  if (THEMATIC_BREAK_RE.test(blockText.slice(0, blockText.indexOf("\n") + 1 || undefined))) {
    return null
  }
  const bullet = BULLET_ITEM_RE.exec(blockText)
  if (bullet) return { kind: "bullet", marker: bullet[1] }
  return null
}

export function isItemLineOf(line: string, family: ListFamily): boolean {
  if (THEMATIC_BREAK_RE.test(line)) return false
  if (family.kind === "ordered") {
    const match = ORDERED_ITEM_RE.exec(line)
    return match !== null && match[2] === family.marker
  }
  const match = BULLET_ITEM_RE.exec(line)
  return match !== null && match[1] === family.marker
}

function isBlankLine(line: string): boolean {
  return /^[ \t]*$/.test(line)
}

/**
 * Whether a PARTIAL (unterminated) line could still become an item line of
 * the given family once more characters arrive: a still-forming marker
 * ("2", "2.", "-") or a marker already followed by content.
 */
export function couldBecomeItemLine(
  partial: string,
  family: ListFamily
): boolean {
  if (family.kind === "ordered") {
    const match = /^ {0,3}(\d{0,9})([.)])?([ \t][\s\S]*)?$/.exec(partial)
    if (!match) return false
    if (match[2] !== undefined && match[2] !== family.marker) return false
    // Content before any digits ("  x") is not a forming marker.
    if (match[3] !== undefined && match[1].length === 0) return false
    return true
  }
  const match = /^ {0,3}([-*+])?([ \t][\s\S]*)?$/.exec(partial)
  if (!match) return false
  if (match[1] === undefined) return match[2] === undefined
  return match[1] === family.marker
}

/**
 * Fence opener facts for a `code` block whose text begins with a fenced
 * opener. Returns null for indented code blocks, non-fence text, or a fence
 * that already contains its closer (a closed fence is a complete block —
 * appended content belongs to a NEW block).
 */
export type OpenFence = {
  marker: "`" | "~"
  /** A closer needs at least this many marker chars. */
  minCloserLength: number
  /** First word of the info string ("" when absent). */
  language: string
  /** Offset of the first interior char (just past the opener line's \n),
   * or text.length when the opener line is still unterminated. */
  interiorStart: number
}

const FENCE_OPENER_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\n]*)/

/**
 * Parse only the opening line's fence facts. Unlike `analyzeOpenFence`, this
 * deliberately does not inspect the interior for a closer, so callers that
 * already validated an accumulated prefix can resume scanning at their saved
 * line boundary instead of re-scanning the whole block.
 */
export function analyzeFenceOpener(text: string): OpenFence | null {
  const opener = FENCE_OPENER_RE.exec(text)
  if (!opener) return null
  const marker = opener[1][0] as "`" | "~"
  // Backtick info strings cannot contain backticks — such text is not a
  // valid fence opener and must go through the parser.
  if (marker === "`" && opener[2].includes("`")) return null
  const openerLineEnd = text.indexOf("\n")
  if (openerLineEnd === -1) {
    return {
      marker,
      minCloserLength: opener[1].length,
      language: opener[2].trim().split(/[ \t]/)[0] ?? "",
      interiorStart: text.length,
    }
  }
  return {
    marker,
    minCloserLength: opener[1].length,
    language: opener[2].trim().split(/[ \t]/)[0] ?? "",
    interiorStart: openerLineEnd + 1,
  }
}

export function analyzeOpenFence(text: string): OpenFence | null {
  const fence = analyzeFenceOpener(text)
  if (!fence) return null
  return hasFenceCloser(text, fence, fence.interiorStart) ? null : fence
}

/**
 * Whether any line at/after `from` closes the fence. The final unterminated
 * line COUNTS: remark recognizes a trailing `\`\`\`` with no newline as the
 * closer (verified against the parser), so mid-stream the moment those bytes
 * arrive the fence is closed — and if later bytes turn the line into interior
 * content again ("```x"), the authoritative parse path re-derives it.
 */
export function hasFenceCloser(
  text: string,
  fence: OpenFence,
  from: number
): boolean {
  const closer = new RegExp(
    `^ {0,3}${fence.marker}{${fence.minCloserLength},}[ \t]*$`
  )
  let lineStart = from
  while (lineStart <= text.length) {
    const lineEnd = text.indexOf("\n", lineStart)
    const line =
      lineEnd === -1 ? text.slice(lineStart) : text.slice(lineStart, lineEnd)
    if (closer.test(line.replace(/\r$/, ""))) return true
    if (lineEnd === -1) return false
    lineStart = lineEnd + 1
  }
  return false
}

/**
 * One classification pass for a growing terminal LIST block: scan from the
 * start of the block's last included line through the end of `source`,
 * strictly classifying complete lines and optimistically including the
 * trailing partial line. Returns the new end offset (which may equal the old
 * one when only trailing blanks arrived), or null when a complete line could
 * not be proven to continue the list — the caller falls back to the
 * authoritative parse paths.
 */
export function extendListBlockEnd(args: {
  source: string
  blockStartOffset: number
  blockEndOffset: number
  family: ListFamily
  /** True when the rescanned first line is preceded by a blank line. */
  lastLineAfterBlank: boolean
}): number | null {
  const { source, blockEndOffset, family } = args
  const lastLineStart =
    source.lastIndexOf("\n", blockEndOffset - 1) + 1
  let committedEnd = blockEndOffset
  let afterBlank = args.lastLineAfterBlank
  let lineStart = lastLineStart
  for (;;) {
    if (lineStart >= source.length) break
    const newlineIndex = source.indexOf("\n", lineStart)
    if (newlineIndex === -1) {
      // Trailing partial line: pending blanks stay excluded. A partial is
      // included optimistically ONLY while it could still extend the list
      // once terminated — lazy prose continuation in tight context, or a
      // still-forming item marker of the same family. Text coverage matches
      // the renderer's own parse either way, and termination re-classifies.
      // A partial that could never extend the list (e.g. "#") bails to the
      // parser immediately so a stream that ENDS on it stays authoritative.
      const partial = source.slice(lineStart)
      if (isBlankLine(partial)) break
      const canStillExtend = afterBlank
        ? couldBecomeItemLine(partial, family)
        : LAZY_SAFE_RE.test(partial) || couldBecomeItemLine(partial, family)
      if (!canStillExtend) return null
      committedEnd = source.length
      break
    }
    const line = source.slice(lineStart, newlineIndex).replace(/\r$/, "")
    if (isBlankLine(line)) {
      afterBlank = true
      lineStart = newlineIndex + 1
      continue
    }
    if (isItemLineOf(line, family)) {
      committedEnd = newlineIndex
      afterBlank = false
      lineStart = newlineIndex + 1
      continue
    }
    if (!afterBlank && lineStart > args.blockStartOffset && LAZY_SAFE_RE.test(line)) {
      // Tight continuation (indented or lazy) extends the current item.
      committedEnd = newlineIndex
      lineStart = newlineIndex + 1
      continue
    }
    return null
  }
  // CRLF sources: a committed end sitting just past a \r must not include it.
  if (source[committedEnd - 1] === "\r") committedEnd -= 1
  return committedEnd
}

// --- Growing list render segmentation --------------------------------------

export type GrowingListSegmentsState = {
  /** The full block text last observed (prefix guard for append-only). */
  lastText: string
  /** Chars of `lastText` covered by frozen fragments. */
  committedLength: number
  fragments: { id: string; text: string }[]
  nextFragmentId: number
  family: ListFamily | null
  /** Scan cursor: line start from which new seams are discovered. */
  scanPos: number
  /** True once any blank line was seen inside the list (loose list). */
  sawBlank: boolean
}

export function initialGrowingListSegmentsState(): GrowingListSegmentsState {
  return {
    lastText: "",
    committedLength: 0,
    fragments: [],
    nextFragmentId: 0,
    family: null,
    scanPos: 0,
    sawBlank: false,
  }
}

/**
 * Advance the frozen-fragment segmentation for a growing list block. Pure and
 * append-only: committed fragments never change; a non-append text change
 * resets the state (the settle re-render replaces this component anyway).
 *
 * Seams sit at top-level item-start lines of the same list family. A frozen
 * fragment must reach `GROWING_LIST_SEGMENT_MIN_CHARS`, and — once the list
 * has shown any internal blank line (a loose list) — must itself contain a
 * blank line, so the standalone fragment parses loose exactly like the items
 * render inside the full list.
 */
export function advanceGrowingListSegments(
  previous: GrowingListSegmentsState,
  text: string
): GrowingListSegmentsState {
  let state = previous
  if (!text.startsWith(state.lastText)) {
    state = initialGrowingListSegmentsState()
  }
  if (text === state.lastText) return previous

  const family = state.family ?? listFamilyOf(text)
  if (!family) {
    return { ...state, lastText: text, family: null }
  }

  let { committedLength, scanPos, sawBlank, nextFragmentId } = state
  const fragments = state.fragments.slice()

  // Discover new seams from the scan cursor. Only COMPLETE lines are
  // considered; the cursor never passes an unterminated line.
  let cursor = scanPos
  for (;;) {
    const newlineIndex = text.indexOf("\n", cursor)
    if (newlineIndex === -1) break
    const lineStart = cursor
    const line = text.slice(lineStart, newlineIndex).replace(/\r$/, "")
    cursor = newlineIndex + 1
    if (isBlankLine(line)) {
      if (lineStart > 0) sawBlank = true
      continue
    }
    if (lineStart === 0) continue
    if (!isItemLineOf(line, family)) continue
    // Candidate seam at `lineStart`: commit the pending region when large
    // enough (and loose-consistent for loose lists).
    const pending = text.slice(committedLength, lineStart)
    if (pending.length < GROWING_LIST_SEGMENT_MIN_CHARS) continue
    if (sawBlank && !/\n[ \t]*\n/.test(pending)) continue
    fragments.push({ id: `seg${nextFragmentId++}`, text: pending })
    committedLength = lineStart
  }
  scanPos = cursor

  return {
    lastText: text,
    committedLength,
    fragments,
    nextFragmentId,
    family,
    scanPos,
    sawBlank,
  }
}

// --- Partial-tail partition equivalence ------------------------------------

export type BlockView = {
  text: string
  nodeType: string
  startOffset: number
  endOffset: number
}

/**
 * View of a block list clipped at the trailing partial line of `source`:
 * blocks starting inside the partial line are dropped, and a block crossing
 * into it is clipped back to the last line boundary with the trailing
 * newline/blank run trimmed (the parser's own end convention). Two block
 * lists that agree on this view and on total coverage partition the SAME
 * bytes and render identically — the partial-line tail is exactly where the
 * parser itself repartitions char by char (a lone "-" is briefly its own
 * paragraph, then merges back into the list at "- x").
 */
export function lineClippedBlockView(
  blocks: readonly BlockView[],
  source: string
): BlockView[] {
  const partialLineStart = source.lastIndexOf("\n") + 1
  const out: BlockView[] = []
  for (const block of blocks) {
    if (block.startOffset >= partialLineStart) continue
    if (block.endOffset <= partialLineStart) {
      const { text, nodeType, startOffset, endOffset } = block
      out.push({ text, nodeType, startOffset, endOffset })
      continue
    }
    const clipped = source
      .slice(block.startOffset, partialLineStart)
      .replace(/[ \t\r\n]+$/, "")
    if (clipped.length === 0) continue
    out.push({
      text: clipped,
      nodeType: block.nodeType,
      startOffset: block.startOffset,
      endOffset: block.startOffset + clipped.length,
    })
  }
  return out
}

export function blocksCoverageEnd(blocks: readonly BlockView[]): number {
  let end = 0
  for (const block of blocks) end = Math.max(end, block.endOffset)
  return end
}

/**
 * Whether two block lists are equivalent modulo the trailing-partial-line
 * partition: identical up to the last line boundary and covering the same
 * total span. Sound because renderers re-parse each block's text — the same
 * bytes render the same regardless of which side of the partition holds the
 * partial tail.
 */
export function blocksEquivalentModuloPartialTail(
  a: readonly BlockView[],
  b: readonly BlockView[],
  source: string
): boolean {
  if (source.endsWith("\n")) return false
  if (blocksCoverageEnd(a) !== blocksCoverageEnd(b)) return false
  const clippedA = lineClippedBlockView(a, source)
  const clippedB = lineClippedBlockView(b, source)
  if (clippedA.length !== clippedB.length) return false
  for (let i = 0; i < clippedA.length; i++) {
    const left = clippedA[i]!
    const right = clippedB[i]!
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

/**
 * Whether the projection's terminal block is preceded by a blank line at the
 * given offset — the `lastLineAfterBlank` input for `extendListBlockEnd`,
 * shared here so both callers agree on the definition.
 */
export function isPrecededByBlankLine(source: string, offset: number): boolean {
  // Matches the projection's isSafeRestartBoundary shape without requiring
  // a completed prior line: scan back over one newline, then blank space,
  // then require another newline (or document start).
  let index = offset - 1
  if (index < 0) return false
  if (source[index] !== "\n") return false
  index--
  if (index >= 0 && source[index] === "\r") index--
  while (index >= 0 && (source[index] === " " || source[index] === "\t")) {
    index--
  }
  if (index < 0) return true
  return source[index] === "\n"
}

/** Convenience: family + blank facts derived once per fast-path attempt. */
export function terminalListFacts(
  source: string,
  block: Pick<MarkdownProjectionBlock, "text" | "startOffset" | "endOffset">
): { family: ListFamily; lastLineAfterBlank: boolean } | null {
  const family = listFamilyOf(block.text)
  if (!family) return null
  const lastLineStart = source.lastIndexOf("\n", block.endOffset - 1) + 1
  return {
    family,
    lastLineAfterBlank:
      lastLineStart > block.startOffset &&
      isPrecededByBlankLine(source, lastLineStart),
  }
}
