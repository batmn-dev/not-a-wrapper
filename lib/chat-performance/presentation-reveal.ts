/**
 * Presentation-reveal core (ADR-0015, smooth-text-streaming plan §6.1).
 *
 * Pure functions only — no React, no timers, no DOM. The reveal is a
 * word-boundary prefix cursor over the canonical streamed text, advanced by
 * the assistant-ui adaptive-rate algorithm (`interval =
 * min(maxCharIntervalMs, drainMs / backlog)` recomputed per tick, fractional
 * time banked, per-tick char cap without surplus banking) and committed at a
 * gated cadence that widens with the terminal block's length (Lobe UI's
 * mitigation for tail-block re-parse cost). The reveal holds no text of its
 * own — only cursors into the canonical string — so displayed content is
 * always a prefix-or-equal of canonical and stale text is unrepresentable.
 *
 * Code-fence interiors are excluded from smoothing by decision (§2.5): the
 * cursor fast-forwards through fence content so code streams at canonical
 * cadence, while prose before and after fences reveals word-by-word.
 */

export type RevealProfile = {
  drainMs: number // target time to drain any backlog
  maxCharIntervalMs: number // slowest per-char interval (rate floor cap)
  maxCharsPerFrame: number // anti-jank per-tick ceiling
  minCommitMs: number // narrowest commit interval
  maxCommitMs: number // widest commit interval (tail-scaled)
  commitWidenChars: number // tail chars that double the commit interval
  maxLagMs: number // hard display-lag cap; excess is snapped
  settleDrainMs: number // drain window after natural completion
}

export const PROSE_REVEAL_PROFILE: RevealProfile = {
  drainMs: 250,
  maxCharIntervalMs: 5,
  maxCharsPerFrame: 120,
  minCommitMs: 48,
  maxCommitMs: 96,
  commitWidenChars: 2048,
  maxLagMs: 1000,
  settleDrainMs: 400,
}

/**
 * Reasoning drains faster than prose (§2 R2): reasoning streams are long and
 * low-stakes, and the activity panel shares the animation budget with prose.
 */
export const REASONING_REVEAL_PROFILE: RevealProfile = {
  ...PROSE_REVEAL_PROFILE,
  drainMs: 150,
  settleDrainMs: 250,
}

export type RevealPhase = "streaming" | "settling"

/**
 * One fenced-code span in the canonical text, tracked incrementally so the
 * cursor can fast-forward through fence interiors. `end` covers through the
 * closing-fence line's newline; `null` while the fence is still open.
 */
type FenceSpan = {
  openStart: number
  contentStart: number
  end: number | null
  marker: "`" | "~"
  markerLen: number
}

export type RevealState = {
  frontier: number // raw char frontier into canonical text
  displayedEnd: number // frontier clamped to word/fence boundary (what renders)
  lastTickMs: number
  carryMs: number // banked fractional time (assistant-ui pattern)
  lastCommitMs: number
  /** First settling tick — settleDrainMs is a hard deadline from here. */
  settleStartMs: number | null
  /** Liveness at creation: non-live (history) state is permanently caught up. */
  live: boolean
  /** Last-seen canonical text — a reference for prefix checks, not a buffer. */
  canonical: string
  /** Incrementally maintained fence spans + scan cursor (line-start offset). */
  fences: FenceSpan[]
  fenceScanPos: number
  /** Offset just past the last "\n\n" within the displayed prefix. */
  lastBlockBoundary: number
}

/** rAF budget the hard-lag cap is computed against (60 Hz frame). */
const FRAME_MS = 16.7

const FENCE_LINE_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/

/**
 * Consumes complete lines from `scanPos`, extending `fences`. Only whole
 * lines are consumed — a trailing partial line is rescanned once its newline
 * arrives, which is what makes incremental scanning safe across chunk
 * boundaries. Returns the new scan position. Mutates `fences` (callers pass
 * a fresh copy).
 */
function scanFences(
  canonical: string,
  fences: FenceSpan[],
  scanPos: number
): number {
  let pos = scanPos
  for (;;) {
    const lineEnd = canonical.indexOf("\n", pos)
    if (lineEnd === -1) return pos
    const line = canonical.slice(pos, lineEnd)
    const open = fences.length > 0 ? fences[fences.length - 1] : undefined
    const openFence = open && open.end === null ? open : undefined
    const match = FENCE_LINE_PATTERN.exec(line)
    if (match) {
      const marker = match[1][0] as "`" | "~"
      const markerLen = match[1].length
      const info = match[2]
      if (openFence) {
        // A closing fence: same marker, at least as long, nothing but
        // whitespace after it.
        if (
          marker === openFence.marker &&
          markerLen >= openFence.markerLen &&
          info.trim() === ""
        ) {
          openFence.end = lineEnd + 1
        }
      } else if (marker === "~" || !info.includes("`")) {
        // A backtick fence's info string may not contain backticks
        // (CommonMark) — that keeps ```code``` inline runs from opening one.
        fences.push({
          openStart: pos,
          contentStart: lineEnd + 1,
          end: null,
          marker,
          markerLen,
        })
      }
    }
    pos = lineEnd + 1
  }
}

/** The fence span containing `offset`, if any (open spans extend to +∞). */
function fenceSpanAt(
  fences: FenceSpan[],
  offset: number
): FenceSpan | undefined {
  for (let i = fences.length - 1; i >= 0; i--) {
    const span = fences[i]
    if (offset > span.openStart && (span.end === null || offset < span.end)) {
      return span
    }
    if (span.end !== null && span.end <= offset) return undefined
  }
  return undefined
}

let cachedSegmenter: Intl.Segmenter | undefined
function wordSegmenter(): Intl.Segmenter {
  cachedSegmenter ??= new Intl.Segmenter(undefined, { granularity: "word" })
  return cachedSegmenter
}

/** Chars of look-ahead segmented past the frontier for boundary detection. */
const SEGMENT_LOOKAHEAD_CHARS = 40

/**
 * Largest word boundary in `(prevEnd, frontier]`, segmenting only the window
 * `[prevEnd, frontier + 40]` — never the whole string. End-of-text counts as
 * a boundary only when `includeEnd` (settling / fence fast-forward): during
 * streaming, the trailing partial word is held back so a fade span's text
 * never changes mid-fade when the rest of the word arrives.
 */
function clampToWordBoundary(
  canonical: string,
  prevEnd: number,
  frontier: number,
  includeEnd: boolean
): number {
  if (frontier <= prevEnd) return prevEnd
  const windowEnd = Math.min(
    canonical.length,
    frontier + SEGMENT_LOOKAHEAD_CHARS
  )
  const window = canonical.slice(prevEnd, windowEnd)
  let best = prevEnd
  for (const segment of wordSegmenter().segment(window)) {
    const segEnd = prevEnd + segment.index + segment.segment.length
    if (segEnd > frontier) break
    if (segEnd === canonical.length && !includeEnd) break
    best = segEnd
  }
  return best
}

/** End offset of the first word segment (leading-edge reveal). */
function endOfFirstSegment(canonical: string): number {
  const window = canonical.slice(0, SEGMENT_LOOKAHEAD_CHARS)
  for (const segment of wordSegmenter().segment(window)) {
    return segment.index + segment.segment.length
  }
  return canonical.length
}

/**
 * Advances `lastBlockBoundary` over the newly displayed slice. Scans from one
 * char before the previous end so a "\n\n" straddling the step is caught.
 */
function advanceBlockBoundary(
  canonical: string,
  previousBoundary: number,
  prevDisplayedEnd: number,
  nextDisplayedEnd: number
): number {
  const from = Math.max(0, prevDisplayedEnd - 1)
  const slice = canonical.slice(from, nextDisplayedEnd)
  const at = slice.lastIndexOf("\n\n")
  return at === -1 ? previousBoundary : from + at + 2
}

/**
 * `live=false` → frontier = displayedEnd = canonical.length: history never
 * animates. `live=true` → reveal from empty (a restarted live row types out).
 */
export function createRevealState(canonical: string, live: boolean): RevealState {
  if (!live) {
    return {
      frontier: canonical.length,
      displayedEnd: canonical.length,
      lastTickMs: -1,
      carryMs: 0,
      lastCommitMs: -1,
      settleStartMs: null,
      live: false,
      canonical,
      fences: [],
      fenceScanPos: canonical.length,
      lastBlockBoundary: 0,
    }
  }
  const fences: FenceSpan[] = []
  const fenceScanPos = scanFences(canonical, fences, 0)
  return {
    frontier: 0,
    displayedEnd: 0,
    lastTickMs: -1,
    carryMs: 0,
    lastCommitMs: -1,
    settleStartMs: null,
    live: true,
    canonical,
    fences,
    fenceScanPos,
    lastBlockBoundary: 0,
  }
}

/**
 * A live state already caught up to `canonical` — the hidden-tab /
 * settle-snap shape: nothing animates now, but later appended text resumes
 * the word reveal from here.
 */
export function createCaughtUpRevealState(canonical: string): RevealState {
  const state = createRevealState(canonical, true)
  const doubleNewline = canonical.lastIndexOf("\n\n")
  return {
    ...state,
    frontier: canonical.length,
    displayedEnd: canonical.length,
    lastBlockBoundary: doubleNewline === -1 ? 0 : doubleNewline + 2,
  }
}

export function advanceReveal(
  state: RevealState,
  canonical: string,
  nowMs: number,
  profile: RevealProfile,
  phase: RevealPhase
): {
  state: RevealState
  shouldCommit: boolean
  caughtUp: boolean
  /** True when the hard lag cap jumped the frontier: the jumped-over text
   * must render already-revealed (no fade births) — callers arm the fade
   * runtime's snap for the resulting commit. */
  lagSnapped: boolean
} {
  if (!state.live) {
    return { state, shouldCommit: false, caughtUp: true, lagSnapped: false }
  }
  const length = canonical.length
  const prevDisplayedEnd = state.displayedEnd
  let frontier = Math.min(state.frontier, length)
  let carryMs = state.carryMs
  const backlog = length - frontier

  // Settling runs against a hard deadline: settleStartMs pins the first
  // settling tick, and the whole backlog must land by settleStartMs +
  // settleDrainMs (drainMs alone is a time-constant — exponential decay
  // that never quite finishes).
  let settleStartMs = state.settleStartMs
  if (phase === "streaming") {
    settleStartMs = null
  } else {
    settleStartMs ??= nowMs
  }

  // Rate math (assistant-ui): interval recomputed from current backlog,
  // fractional time banked, per-tick cap discards surplus (anti-burst).
  const elapsed =
    state.lastTickMs < 0 ? 0 : Math.max(0, nowMs - state.lastTickMs) + carryMs
  if (backlog > 0 && elapsed > 0) {
    const remainingSettleMs =
      phase === "settling"
        ? settleStartMs! + profile.settleDrainMs - nowMs
        : null
    if (remainingSettleMs !== null && remainingSettleMs <= 0) {
      // Deadline hit: flush the tail outright (event-driven, cap-exempt —
      // mirrors the hook's timer backstop semantics).
      frontier = length
      carryMs = 0
    } else {
      const budgetMs =
        remainingSettleMs !== null ? remainingSettleMs : profile.drainMs
      const interval = Math.min(profile.maxCharIntervalMs, budgetMs / backlog)
      let chars = Math.floor(elapsed / interval)
      if (chars > profile.maxCharsPerFrame) {
        chars = profile.maxCharsPerFrame
        carryMs = 0
      } else {
        carryMs = elapsed - chars * interval
      }
      frontier = Math.min(length, frontier + chars)
      if (frontier >= length) carryMs = 0
    }
  } else if (backlog <= 0) {
    carryMs = 0
  }

  // Hard lag cap: if the max drain rate cannot clear the backlog within
  // maxLagMs, jump the frontier so projected lag equals maxLagMs. The
  // jumped-over text renders as already revealed — `lagSnapped` tells the
  // caller to arm the fade runtime's snap so no fade births are assigned.
  let lagSnapped = false
  const maxClearableChars = Math.floor(
    profile.maxCharsPerFrame * (profile.maxLagMs / FRAME_MS)
  )
  if (length - frontier > maxClearableChars) {
    frontier = length - maxClearableChars
    lagSnapped = true
  }

  // Word clamp on the segmenter window; end-of-text is a boundary only when
  // settling (streaming holds the trailing partial word back).
  let displayedEnd = clampToWordBoundary(
    canonical,
    prevDisplayedEnd,
    frontier,
    phase === "settling"
  )

  // Leading edge: first text is never delayed — the first advance after the
  // canonical text becomes non-empty always reveals at least the first word.
  if (prevDisplayedEnd === 0 && displayedEnd === 0 && length > 0) {
    displayedEnd = Math.min(length, endOfFirstSegment(canonical))
    frontier = Math.max(frontier, displayedEnd)
  }

  // Fence fast-forward: interiors reveal at canonical cadence (§2.5). An
  // open fence extends to the end of arrived text; a closed fence forwards
  // to just past its closing line, where prose resumes the word reveal.
  for (;;) {
    const span = fenceSpanAt(state.fences, displayedEnd)
    if (!span) break
    const target = Math.min(length, span.end ?? length)
    if (target <= displayedEnd) break
    displayedEnd = target
    frontier = Math.max(frontier, target)
  }

  const displayedChanged = displayedEnd !== prevDisplayedEnd
  const lastBlockBoundary = displayedChanged
    ? advanceBlockBoundary(
        canonical,
        state.lastBlockBoundary,
        prevDisplayedEnd,
        displayedEnd
      )
    : state.lastBlockBoundary

  // Caught up when the frontier has consumed everything and the clamp cannot
  // move further (streaming may hold a trailing partial word — growth
  // restarts the loop and completes it).
  const caughtUp =
    frontier >= length &&
    (displayedEnd >= length ||
      displayedEnd ===
        clampToWordBoundary(
          canonical,
          displayedEnd,
          length,
          phase === "settling"
        ))

  // Commit gate: interval widens with the terminal block's length (chars
  // since the last displayed "\n\n" — a cheap proxy for block membership).
  const tailBlockChars = displayedEnd - lastBlockBoundary
  const commitInterval = Math.min(
    profile.maxCommitMs,
    profile.minCommitMs * (1 + tailBlockChars / profile.commitWidenChars)
  )
  const gateOpen =
    state.lastCommitMs < 0 || nowMs - state.lastCommitMs >= commitInterval
  const leadingEdge = prevDisplayedEnd === 0 && displayedEnd > 0
  // The catching-up tick always commits (both phases): the loop stops on
  // caughtUp, so an uncommitted tail would otherwise stick until the next
  // canonical update.
  const shouldCommit = displayedChanged && (gateOpen || leadingEdge || caughtUp)

  return {
    state: {
      ...state,
      frontier,
      displayedEnd,
      lastTickMs: nowMs,
      carryMs,
      lastCommitMs: shouldCommit ? nowMs : state.lastCommitMs,
      settleStartMs,
      canonical,
      lastBlockBoundary,
    },
    shouldCommit,
    caughtUp,
    lagSnapped,
  }
}

export function reconcileCanonical(
  state: RevealState,
  nextCanonical: string,
  identityChanged: boolean
): { state: RevealState; discontinuity: "none" | "snap" } {
  if (!state.live) {
    return {
      state: {
        ...state,
        canonical: nextCanonical,
        frontier: nextCanonical.length,
        displayedEnd: nextCanonical.length,
      },
      discontinuity: "none",
    }
  }
  // Append-only growth is the hot path (one prefix memcmp, checked first —
  // it implies the displayed prefix survived): extend the fence span list
  // over the appended slice only (plus the trailing partial line the scan
  // cursor holds).
  if (!identityChanged && nextCanonical.startsWith(state.canonical)) {
    if (nextCanonical.length === state.canonical.length) {
      return { state, discontinuity: "none" }
    }
    const fences = state.fences.map((span) => ({ ...span }))
    const fenceScanPos = scanFences(nextCanonical, fences, state.fenceScanPos)
    return {
      state: { ...state, canonical: nextCanonical, fences, fenceScanPos },
      discontinuity: "none",
    }
  }
  const displayedPrefix = state.canonical.slice(0, state.displayedEnd)
  if (identityChanged || !nextCanonical.startsWith(displayedPrefix)) {
    // A new part sharing a prefix must not keep a stale cursor
    // (assistant-ui's part-identity rule); a non-prefix correction or shrink
    // resets outright — a live row restarts from empty.
    return {
      state: createRevealState(nextCanonical, true),
      discontinuity: "snap",
    }
  }
  // The displayed prefix survived but undisplayed backlog was rewritten
  // (snapshot adoption): keep the cursor, rebuild the fence map.
  const fences: FenceSpan[] = []
  const fenceScanPos = scanFences(nextCanonical, fences, 0)
  return {
    state: {
      ...state,
      canonical: nextCanonical,
      frontier: Math.min(state.frontier, nextCanonical.length),
      fences,
      fenceScanPos,
    },
    discontinuity: "none",
  }
}
