/**
 * Growing-block tail helpers.
 *
 * Single-block content — a list without blank-line separators, an open code
 * fence — never presents a blank-line-preceded block start, so the block
 * projection's stable boundary stays pinned at the block's start and every
 * streaming update re-parses AND re-renders the entire growing block:
 * per-update cost grows with response length (the measured "smooth at first,
 * chunky later" degradation). This module bounds the parser work and the
 * open-fence renderer:
 *
 *  - PARSE: `tryExtendTerminalBlock` lets the projection extend a growing
 *    list/fence block by classifying appended LINES (a scan, not a parse).
 *    Classification is conservative: any line it cannot prove to continue
 *    the block bails to the projection's existing authoritative paths, and
 *    settlement's full-parse equivalence check remains the safety net.
 *  - RENDER: `analyzeOpenFence` lets the component render a growing fence
 *    directly (no per-update Markdown re-parse of the interior). Growing
 *    lists remain one canonical semantic root; fragmenting them changes
 *    accessibility and selection-copy semantics.
 *
 * Partition-vs-content invariant: block records only place BOUNDARIES; the
 * renderer re-parses each block's text, so a transiently optimistic boundary
 * (a partial line included in the list block while it could still become
 * anything) renders identically to the authoritative partition as long as
 * text coverage matches. Complete lines are therefore classified strictly,
 * while the trailing partial line is included optimistically and
 * re-classified once terminated.
 */

import remend, { type RemendOptions } from "remend"
import type { MarkdownProjectionBlock } from "./incremental-block-projection"

export type ListFamily = {
  kind: "ordered" | "bullet"
  /** `.`/`)` for ordered, the literal marker char for bullets — a marker
   * change starts a NEW list per CommonMark, so it must bail. */
  marker: string
}

const ORDERED_ITEM_RE = /^( {0,3})(\d{1,9})([.)])[ \t]+\S/
const BULLET_ITEM_RE = /^( {0,3})([-*+])[ \t]+\S/
const THEMATIC_BREAK_RE = /^ {0,3}([-*_])([ \t]*\1){2,}[ \t]*$/
/** Complete-line lazy continuation whitelist: indented continuation, or a
 * paragraph-continuation line starting with clearly inert prose characters.
 * Everything else (fences, headings, quotes, setext/thematic candidates,
 * tables, html) is ambiguous and bails to the parser. */
const LAZY_SAFE_RE = /^(?:[ \t]|[A-Za-z0-9"'‘’“”([{])/

type ListItemMarker = {
  family: ListFamily
}

function listItemMarkerOf(line: string): ListItemMarker | null {
  if (THEMATIC_BREAK_RE.test(line)) return null
  const ordered = ORDERED_ITEM_RE.exec(line)
  if (ordered) {
    return {
      family: { kind: "ordered", marker: ordered[3] },
    }
  }
  const bullet = BULLET_ITEM_RE.exec(line)
  if (bullet) {
    return {
      family: { kind: "bullet", marker: bullet[2] },
    }
  }
  return null
}

function sameListFamily(left: ListFamily, right: ListFamily): boolean {
  return left.kind === right.kind && left.marker === right.marker
}

export function listFamilyOf(blockText: string): ListFamily | null {
  const firstNewline = blockText.indexOf("\n")
  const firstLine =
    firstNewline === -1 ? blockText : blockText.slice(0, firstNewline)
  return listItemMarkerOf(firstLine.replace(/\r$/, ""))?.family ?? null
}

export function isItemLineOf(line: string, family: ListFamily): boolean {
  const marker = listItemMarkerOf(line)
  return marker !== null && sameListFamily(marker.family, family)
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
  const lastLineStart = source.lastIndexOf("\n", blockEndOffset - 1) + 1
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
    if (
      !afterBlank &&
      lineStart > args.blockStartOffset &&
      LAZY_SAFE_RE.test(line)
    ) {
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

/**
 * A terminal growing block can expose raw delimiters (`**`, `](`, and `|`
 * header rows) because it paints its canonical tail verbatim every frame.
 * The fix is a RENDER-BOUNDARY transform of the growing block's text only:
 * the canonical store, projection boundaries, settlement, and durable
 * snapshots never see mended text, and a settled block always renders its
 * exact canonical bytes (a Stop mid-`**bold` shows the raw characters — they
 * are settled content, not a transient).
 *
 * Inline constructs are completed, not withheld (`**bol` renders as bold
 * "bol"). `remend` owns that completion; it guards code spans, open
 * fences, math regions, and escaped delimiters internally. Tables are the
 * one construct completion cannot fake: a pipe-led trailing run is GATED
 * (clipped from the render) until a completed GFM delimiter row proves the
 * table.
 */
const MEND_REMEND_OPTIONS = {
  // `[label](partial-url` renders the label as plain text; the anchor
  // appears when the URL completes. The default sentinel-URL mode relies on
  // the consumer's urlTransform to neutralize an unknown protocol — clipping
  // the markup instead keeps the contract local to this module.
  linkMode: "text-only",
  // Matches REMARK_MATH_OPTIONS.singleDollarTextMath: false — a lone `$` is
  // currency, not math, in this pipeline.
  inlineKatex: false,
} satisfies RemendOptions

const PIPE_LED_LINE_RE = /^ {0,3}\|/
/** GFM table delimiter row: `|---|:--:|` etc — at least one dash cell. */
const TABLE_DELIMITER_ROW_RE =
  /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/
/** Blockquote prefix (`> `, `> > `, `>`), stripped before row classification
 * so quoted tables gate and prove the same way top-level ones do. */
const BLOCKQUOTE_PREFIX_RE = /^ {0,3}(?:> ?)+/

function isEscaped(text: string, index: number): boolean {
  let backslashCount = 0
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) {
    backslashCount++
  }
  return backslashCount % 2 === 1
}

/** Require two non-empty cells before treating a pipe-led line as a table
 * header. A leading pipe alone is also valid shell-pipeline prose. */
function isPlausibleTableHeaderRow(line: string): boolean {
  const trimmed = line.trimEnd()
  const leadingPipe = trimmed.indexOf("|")
  if (leadingPipe === -1) return false

  const cells: string[] = []
  let cellStart = leadingPipe + 1
  for (let i = cellStart; i < trimmed.length; i++) {
    if (trimmed[i] !== "|" || isEscaped(trimmed, i)) continue
    cells.push(trimmed.slice(cellStart, i).trim())
    cellStart = i + 1
  }
  if (cellStart < trimmed.length) {
    cells.push(trimmed.slice(cellStart).trim())
  }
  return cells.length >= 2 && cells.every((cell) => cell.length > 0)
}

/**
 * Clip an UNPROVEN trailing table candidate: a trailing run whose first line
 * has a plausible multi-cell header shape, unless the run contains a COMPLETE
 * (newline-terminated) delimiter row — once the delimiter row lands, remark
 * parses a real table and its own partial-trailing-row tolerance takes over.
 * Pure text-in/text-out; callers must not pass open-fence (`code`) blocks,
 * whose interiors may legitimately contain pipe-led lines.
 */
export function clipUnprovenTableTail(text: string): string {
  const lines = text.split("\n")
  // A trailing newline produces a final empty split segment that is NOT a
  // line — the newline terminates the pipe-led line before it. Scanning from
  // that empty segment would break the run and let a newline-terminated
  // header row (`"| A | B |\n"`, awaiting its delimiter row) render raw.
  const endsWithNewline = text.endsWith("\n")
  const lineCount = endsWithNewline ? lines.length - 1 : lines.length
  const rowText = (line: string) => line.replace(BLOCKQUOTE_PREFIX_RE, "")
  let runStart = lineCount
  while (runStart > 0 && PIPE_LED_LINE_RE.test(rowText(lines[runStart - 1]!))) {
    runStart--
  }
  if (runStart === lineCount) return text
  if (!isPlausibleTableHeaderRow(rowText(lines[runStart]!))) return text
  for (let i = runStart; i < lineCount; i++) {
    const isTerminalPartial = i === lineCount - 1 && !endsWithNewline
    if (
      !isTerminalPartial &&
      TABLE_DELIMITER_ROW_RE.test(rowText(lines[i]!).replace(/\r$/, ""))
    ) {
      return text
    }
  }
  return lines
    .slice(0, runStart)
    .join("\n")
    .replace(/[ \t]*$/, "")
}

/**
 * The render-boundary mend for the growing terminal block. Applied by the
 * Markdown component ONLY while the block is growing (`streaming` message,
 * terminal block, non-`code` nodeType); every other render path — stable
 * blocks, settlement, terminal outcomes — renders exact canonical text.
 */
export function mendGrowingBlockTail(text: string): string {
  return remend(clipUnprovenTableTail(text), MEND_REMEND_OPTIONS)
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
