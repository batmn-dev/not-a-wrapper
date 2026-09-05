"use client"

/**
 * Streaming color-decay overlay (ADR-0016).
 *
 * Newly arrived words paint near-transparent and materialize to full foreground
 * color without changing content DOM: cohorts of appended rendered text are painted
 * through the CSS Custom Highlight API (`CSS.highlights` +
 * `::highlight(naw-stream-decay-N)` rules this module injects as a constructed
 * stylesheet). A temporary root attribute scopes the rules; settlement removes
 * it, leaving canonical DOM and the rendered-DOM equivalence corpus unaffected.
 *
 * The `::highlight` rules live here rather than in globals.css because
 * Turbopack's CSS parser rejects the pseudo-element and warns on every
 * compile (vercel/next.js#85398); runtime injection also keeps the rules out
 * of browsers that never pass the `CSS.highlights` support gate below.
 *
 * Each append cohort fades as one unit on a ~400ms linear alpha ramp with no
 * per-word stagger. Consecutive flush cohorts create the trailing gradient.
 *
 * Invariant boundaries:
 * - Paint only. Text is never gated, reordered, or delayed — this is not a
 *   reveal scheduler. The only state is per-container append cohorts
 *   ({start, end, arrivedAt} over rendered textContent), pruned by age.
 * - Append detection diffs RENDERED text between commits, so the mend pass
 *   needs no offset mapping: mended completions and a table proven out of
 *   `clipUnprovenTableTail` simply arrive as one cohort and fade together.
 * - A non-append change (correction, identity change, clip shrink) resets
 *   the baseline with zero cohorts — rewritten or adopted text (reload,
 *   nav-return) never flash-fades. First observation of a container seeds
 *   the baseline the same way.
 * - The rAF loop is self-terminating: it runs only while cohorts exist
 *   (bounded by DECAY_TOTAL_MS past the last append) and drops expired
 *   cohorts by age, so a hidden tab resumes to a cleared overlay instead of
 *   animating a backlog.
 * - No-ops without `CSS.highlights` support or under
 *   `prefers-reduced-motion: reduce`.
 */

export type DecayCohort = {
  /** Offsets into the container's rendered textContent. */
  start: number
  end: number
  arrivedAt: number
}

/* 12 × 33ms ≈ 400ms; the quantized ramp reads as continuous. */
export const DECAY_BUCKET_COUNT = 12
export const DECAY_BUCKET_MS = 33
export const DECAY_TOTAL_MS = DECAY_BUCKET_COUNT * DECAY_BUCKET_MS
/**
 * A mid-word append merges the word's earlier fragment into the new cohort
 * only when the whole word fits this window. Latin words practically always
 * do; unspaced scripts (CJK, Thai) never find a boundary, so their appends
 * fade as independent cohorts instead of re-timing an ever-growing run —
 * without this cap, continuous CJK streaming collapsed into ONE cohort whose
 * decay clock reset on every append, holding the entire streamed run near
 * bucket 0 (near-transparent) until the stream paused. Provider deltas can
 * split words, so the merge must stay bounded.
 */
export const MAX_WORD_MERGE_CHARS = 16
/**
 * The rAF loop repaints at this cadence, not per frame: bucket assignments
 * only change every DECAY_BUCKET_MS, and each paint rebuilds StaticRanges
 * for the live text tail — per-frame rebuilds on a
 * 100KB-class message would burn frame budget for identical output. Appends
 * still paint immediately via observe().
 */
export const PAINT_MIN_INTERVAL_MS = 24
/**
 * How many trailing chars of the previous rendered text a mid-stream parse
 * flip may rewrite while keeping the fade alive. Flips are small: a list
 * marker ("2.") or quote ">" moving out of textContent into structure, a
 * setext underline collapsing into a heading, a thematic break vanishing.
 * Anything larger (message identity change, adoption, KaTeX render swap)
 * resets without animating — stale offsets must never tint wrong text.
 */
export const MAX_FLIP_WINDOW_CHARS = 64

const highlightName = (bucket: number) => `naw-stream-decay-${bucket}`
const decayRootAttribute = "data-streaming-decay-root"

/**
 * The bucket ramp paints each bucket at the midpoint of its slice of the
 * fade, so bucket 0 starts near-transparent (4%) and the last bucket lands
 * near-opaque (96%) instead of pinning the endpoints to 0%/100%.
 */
export function decayStylesheetText(): string {
  // Highlight color inherits through descendants independently of their text
  // color: https://drafts.csswg.org/css-pseudo-4/#highlight-cascade
  const rules = Array.from({ length: DECAY_BUCKET_COUNT }, (_, bucket) => {
    const alpha = Math.round(((bucket + 0.5) / DECAY_BUCKET_COUNT) * 100)
    return `  [${decayRootAttribute}]::highlight(${highlightName(bucket)}) { color: color-mix(in oklab, var(--foreground) ${alpha}%, transparent); }`
  }).join("\n")
  return `@media (prefers-reduced-motion: no-preference) {\n${rules}\n}`
}

const styledDocuments = new WeakSet<Document>()

function ensureDecayStylesheet(document: Document): void {
  if (styledDocuments.has(document)) return
  styledDocuments.add(document)
  try {
    const SheetCtor = document.defaultView?.CSSStyleSheet ?? CSSStyleSheet
    const sheet = new SheetCtor()
    sheet.replaceSync(decayStylesheetText())
    document.adoptedStyleSheets.push(sheet)
  } catch {
    // Constructable stylesheets unavailable (jsdom): a <style> node carries
    // the same rules.
    const style = document.createElement("style")
    style.textContent = decayStylesheetText()
    document.head.appendChild(style)
  }
}

/**
 * Pure cohort transition for one observed commit. Returns the next cohort
 * list for the container given the previously observed rendered text and the
 * current one. Exported for tests; the manager owns when it runs.
 */
export function advanceDecayCohorts(args: {
  previousText: string | null
  nextText: string
  cohorts: readonly DecayCohort[]
  now: number
}): DecayCohort[] {
  const { previousText, nextText, cohorts, now } = args
  const pruned = cohorts.filter((c) => now - c.arrivedAt < DECAY_TOTAL_MS)
  // First observation (mount/adoption) — seed the baseline, animate nothing.
  if (previousText === null) return []
  if (nextText === previousText) return pruned

  // Diff at the common prefix. Pure appends land here with the prefix at
  // previousText.length; mid-stream parse flips (a list marker or quote ">"
  // leaving textContent for ::marker/structure, a setext underline
  // collapsing into a heading) rewrite only a SMALL trailing window, so
  // cohorts before the prefix keep their decay and the rewritten+appended
  // suffix fades as one fresh cohort. A large rewrite resets without
  // animating — stale offsets must never tint the wrong characters.
  let prefix: number
  if (
    nextText.length > previousText.length &&
    nextText.startsWith(previousText)
  ) {
    // Pure append — the overwhelmingly common commit. startsWith is a native
    // memcmp; the per-character fallback below on a 100KB-class message per
    // commit would be O(n²) over the stream.
    prefix = previousText.length
  } else {
    prefix = 0
    const shared = Math.min(previousText.length, nextText.length)
    while (prefix < shared && previousText[prefix] === nextText[prefix]) {
      prefix++
    }
  }
  if (previousText.length - prefix > MAX_FLIP_WINDOW_CHARS) return []

  const kept: DecayCohort[] = []
  for (const cohort of pruned) {
    if (cohort.end <= prefix) kept.push(cohort)
    else if (cohort.start < prefix) kept.push({ ...cohort, end: prefix })
  }
  let start = prefix
  if (start >= nextText.length) return kept

  // Snap to a word boundary so a word always fades as a unit. Only on pure
  // appends whose boundary chars are both word characters: a provider token
  // split mid-word ("hel" + "lo"). A parse flip never snaps (its suffix
  // starts at a structural boundary), and punctuation adjacency from block
  // concatenation in textContent ("universities." + "During") must not
  // merge — block elements contribute no separator, so a non-word boundary
  // is the only reliable "different word" signal. If the append continues a
  // word whose earlier fragment belongs to the still-live preceding cohort,
  // that fragment moves into the new cohort (refreshing its decay by one
  // append interval) instead of leaving two halves of one word tinted
  // differently. The merge is bounded by MAX_WORD_MERGE_CHARS: the scan
  // stops at any non-word character (whitespace OR punctuation), and a "word"
  // longer than the cap does not merge at all — in unspaced scripts (CJK,
  // Thai) every append continues one endless "word", and an unbounded merge
  // re-timed the entire streamed run to bucket 0 on every append. Fully
  // decayed text is never re-tinted.
  const previous = kept.at(-1)
  const wordChar = /[\p{L}\p{N}]/u
  const continuesWord =
    prefix === previousText.length &&
    start > 0 &&
    wordChar.test(nextText[start - 1]!) &&
    wordChar.test(nextText[start]!)
  if (continuesWord && previous && previous.end === start) {
    const scanFloor = Math.max(0, start - MAX_WORD_MERGE_CHARS)
    let wordStart = start
    while (wordStart > scanFloor && wordChar.test(nextText[wordStart - 1]!)) {
      wordStart--
    }
    const boundaryFound =
      wordStart === 0 || !wordChar.test(nextText[wordStart - 1]!)
    const mergedStart = Math.max(wordStart, previous.start)
    if (boundaryFound && mergedStart < start) {
      start = mergedStart
      if (mergedStart > previous.start) {
        kept[kept.length - 1] = { ...previous, end: mergedStart }
      } else {
        kept.pop()
      }
    }
  }
  return [...kept, { start, end: nextText.length, arrivedAt: now }]
}

/** Age bucket: 0 = newest/most transparent. */
export function decayBucketForAge(ageMs: number): number {
  const age = Math.max(0, ageMs)
  return Math.min(DECAY_BUCKET_COUNT - 1, Math.floor(age / DECAY_BUCKET_MS))
}

/** Age bucket for a cohort: 0 = newest/most transparent. */
export function decayBucketOf(cohort: DecayCohort, now: number): number {
  return decayBucketForAge(now - cohort.arrivedAt)
}

type ContainerState = {
  baseline: string | null
  cohorts: DecayCohort[]
}

function isSupported(): boolean {
  return (
    typeof CSS !== "undefined" &&
    "highlights" in CSS &&
    typeof Highlight !== "undefined" &&
    typeof StaticRange !== "undefined"
  )
}

let reducedMotionQuery: MediaQueryList | null | undefined
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false
  if (reducedMotionQuery === undefined) {
    reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
  }
  return reducedMotionQuery?.matches ?? false
}

class StreamingDecayManager {
  private states = new Map<Element, ContainerState>()
  private rafHandle: number | null = null
  private lastPaintAt = Number.NEGATIVE_INFINITY
  private bucketHighlights: Highlight[] | null = null

  /**
   * Register bucket Highlights once and mutate their ranges. Replacing registry
   * entries each tick invalidates `::highlight()` matching document-wide in
   * Chromium and turns this paint-only overlay into repeated layout work.
   */
  private ensureBucketHighlights(): Highlight[] {
    if (this.bucketHighlights) return this.bucketHighlights
    this.bucketHighlights = Array.from(
      { length: DECAY_BUCKET_COUNT },
      (_, bucket) => {
        const highlight = new Highlight()
        CSS.highlights.set(highlightName(bucket), highlight)
        return highlight
      }
    )
    return this.bucketHighlights
  }

  /**
   * Observe one committed render of a streaming container. Idempotent per
   * commit: an unchanged container only prunes.
   */
  observe(container: Element): void {
    if (!isSupported() || prefersReducedMotion()) return
    ensureDecayStylesheet(container.ownerDocument)
    const now = performance.now()
    const existing = this.states.get(container)
    if (!existing) container.setAttribute(decayRootAttribute, "")
    const state = existing ?? {
      baseline: null,
      cohorts: [],
    }
    const nextText = container.textContent ?? ""
    state.cohorts = advanceDecayCohorts({
      previousText: state.baseline,
      nextText,
      cohorts: state.cohorts,
      now,
    })
    state.baseline = nextText
    this.states.set(container, state)
    // A hidden tab keeps streaming commits flowing, but building StaticRanges
    // nobody can see is waste — cohorts still advance above, and the rAF loop
    // (paused while hidden) prunes and repaints on the first visible frame.
    if (!container.ownerDocument.hidden) this.paint(now)
    this.ensureLoop()
  }

  /** Settlement/unmount: drop the container and repaint without it. */
  settle(container: Element): void {
    if (!this.states.delete(container)) return
    container.removeAttribute(decayRootAttribute)
    this.paint(performance.now())
  }

  /** Preference off: drop everything and clear every bucket immediately. */
  clearAll(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle)
      this.rafHandle = null
    }
    if (this.states.size > 0) {
      for (const container of this.states.keys()) {
        container.removeAttribute(decayRootAttribute)
      }
      this.states.clear()
      this.paint(performance.now())
    }
    // Unregister and drop the persistent highlights: a later re-enable
    // re-registers against the then-current globals (this also keeps a test's
    // stubbed Highlight/CSS globals from outliving the stub through the
    // module singleton).
    if (this.bucketHighlights && isSupported()) {
      for (let bucket = 0; bucket < DECAY_BUCKET_COUNT; bucket++) {
        CSS.highlights.delete(highlightName(bucket))
      }
    }
    this.bucketHighlights = null
  }

  private ensureLoop(): void {
    if (this.rafHandle !== null) return
    if (![...this.states.values()].some((s) => s.cohorts.length > 0)) return
    this.rafHandle = requestAnimationFrame(this.tick)
  }

  private tick = (): void => {
    this.rafHandle = null
    const now = performance.now()
    let live = false
    for (const state of this.states.values()) {
      state.cohorts = state.cohorts.filter(
        (c) => now - c.arrivedAt < DECAY_TOTAL_MS
      )
      live ||= state.cohorts.length > 0
    }
    // Throttled: bucket assignments change on a DECAY_BUCKET_MS grid, so
    // rebuilding ranges every frame produces identical output most frames.
    // The terminal tick always paints so expiry clears every bucket.
    if (!live || now - this.lastPaintAt >= PAINT_MIN_INTERVAL_MS) {
      this.paint(now)
    }
    if (live) this.rafHandle = requestAnimationFrame(this.tick)
  }

  /** Rebuild every bucket highlight from current cohorts. */
  private paint(now: number): void {
    if (!isSupported()) return
    this.lastPaintAt = now
    const buckets: StaticRange[][] = Array.from(
      { length: DECAY_BUCKET_COUNT },
      () => []
    )
    for (const [container, state] of this.states) {
      if (!container.isConnected || state.cohorts.length === 0) continue
      collectCohortRanges(
        container,
        state.baseline ?? "",
        state.cohorts,
        now,
        buckets
      )
    }
    const highlights = this.ensureBucketHighlights()
    for (let bucket = 0; bucket < DECAY_BUCKET_COUNT; bucket++) {
      const highlight = highlights[bucket]!
      highlight.clear()
      for (const range of buckets[bucket]!) highlight.add(range)
    }
  }
}

/**
 * Map cohort text offsets onto the container's current text nodes as
 * StaticRanges, appended into `buckets` by cohort age. Ranges are rebuilt on
 * every paint because React may have replaced the underlying nodes; offsets
 * beyond the current text (a shrink between observe calls) simply produce no
 * range.
 */
function collectCohortRanges(
  container: Element,
  baselineText: string,
  cohorts: readonly DecayCohort[],
  now: number,
  buckets: StaticRange[][]
): void {
  type PaintSpan = { start: number; end: number; bucket: number }
  // One span per cohort: the whole cohort fades as a unit, so per-word range
  // splitting would only multiply
  // identical-bucket StaticRanges.
  const spans: PaintSpan[] = []
  for (const cohort of cohorts) {
    const age = now - cohort.arrivedAt
    if (age >= DECAY_TOTAL_MS) continue
    const start = cohort.start
    const end = Math.min(cohort.end, baselineText.length)
    if (start >= end) continue
    spans.push({ start, end, bucket: decayBucketForAge(age) })
  }
  if (spans.length === 0) return
  const minStart = Math.min(...spans.map((s) => s.start))
  const maxEnd = Math.max(...spans.map((s) => s.end))
  const document = container.ownerDocument
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  // Count current rendered characters natively, then walk backward only as far
  // as the live cohorts. Re-reading length also handles DOM shrink between commits.
  let offset = container.textContent?.length ?? 0
  for (
    let node = walker.lastChild();
    node !== null;
    node = walker.previousNode()
  ) {
    const text = node as Text
    const length = text.data.length
    const nodeEnd = offset
    const nodeStart = offset - length
    offset = nodeStart
    if (nodeEnd <= minStart) break
    if (nodeStart >= maxEnd) continue
    for (const span of spans) {
      const start = Math.max(span.start, nodeStart)
      const end = Math.min(span.end, nodeEnd)
      if (start >= end) continue
      buckets[span.bucket]!.push(
        new StaticRange({
          startContainer: text,
          startOffset: start - nodeStart,
          endContainer: text,
          endOffset: end - nodeStart,
        })
      )
    }
  }
}

const manager = new StreamingDecayManager()

/**
 * User preference gate (settings → "Smooth text streaming"). Centralized
 * here so every consumer of the overlay obeys one switch: disabling clears
 * all live cohorts and repaints immediately (a mid-stream toggle removes
 * tint on the spot), and `observeStreamingDecay` becomes a no-op until
 * re-enabled. Synced from UserPreferencesProvider; defaults on.
 */
let decayEnabled = true

export function setStreamingDecayEnabled(enabled: boolean): void {
  if (decayEnabled === enabled) return
  decayEnabled = enabled
  if (!enabled) manager.clearAll()
}

export function observeStreamingDecay(container: Element): void {
  if (!decayEnabled) return
  manager.observe(container)
}

export function settleStreamingDecay(container: Element): void {
  manager.settle(container)
}
