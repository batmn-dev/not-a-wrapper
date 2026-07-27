/**
 * Stream word-fade renderer (ADR-0015, smooth-text-streaming plan §6.2).
 *
 * A rehype plugin plus a birth-timeline runtime (the Lobe UI technique): the
 * growing terminal Markdown block's word segments are wrapped in spans whose
 * CSS fade is timed by per-word "birth" timestamps. Styles are write-once —
 * a word's animation-delay is frozen the first time it is computed, so
 * re-renders repeat identical values and React never rewrites the style of
 * an in-flight fade (a rewrite restarts a CSS animation — the central
 * hazard). Negative delays make even a remounted span resume mid-fade
 * instead of restarting.
 *
 * Stagger is paced from the observed commit gap ÷ new words (clamped to
 * [8, 80] ms) so per-word flow looks continuous across variable commit
 * intervals; a birth cap (`now + gap + fade`) prevents fades scheduled far
 * into the future when a large append lands in one commit.
 *
 * The plugin walks ONE block's hast tree. It calls `noteCommit` itself at
 * transform time — the render is the commit, and transform-time is the only
 * place the block's word count and identity are both known — which is why
 * `noteCommit` must be idempotent under StrictMode double render.
 */
import type { Element, ElementContent, Parents, Root, Text } from "hast"

const FADE_MS = 180
const MIN_STAGGER_MS = 8
const MAX_STAGGER_MS = 80

export type StreamFadeStyle = {
  className: "stream-word" | "stream-word stream-word-revealed"
  style?: { animationDelay: string }
}

type BlockFadeState = {
  /** High-water RENDERED word count — commit detection only, never word
   * identity (rendered counts shrink when Markdown syntax closes). */
  highWaterCount: number
  lastCommitAtMs: number
  /** Pacing for births assigned under the current commit. */
  paceMs: number
  birthCapMs: number
  backdateBirths: boolean
  lastAssignedBirthMs: number
  /** Keyed by word key (source-offset based): stable across re-parses. */
  births: Map<number, number>
  styles: Map<number, StreamFadeStyle>
}

/** Shared frozen result for words whose fade has already elapsed. */
const REVEALED_STYLE: StreamFadeStyle = Object.freeze({
  className: "stream-word stream-word-revealed",
})

export type StreamFadeRuntime = ReturnType<typeof createStreamFadeRuntime>

export function createStreamFadeRuntime() {
  const blocks = new Map<string, BlockFadeState>()
  let snapPending = false

  const ensure = (blockKey: string): BlockFadeState => {
    let block = blocks.get(blockKey)
    if (!block) {
      block = {
        highWaterCount: 0,
        lastCommitAtMs: -1,
        paceMs: MIN_STAGGER_MS,
        birthCapMs: -1,
        backdateBirths: false,
        lastAssignedBirthMs: -Infinity,
        births: new Map(),
        styles: new Map(),
      }
      blocks.set(blockKey, block)
    }
    return block
  }

  return {
    /**
     * Records one commit's pacing: observed gap ÷ new words (clamped) and
     * the birth cap. Births themselves are assigned lazily by `styleFor`,
     * KEYED BY WORD (source offset), so a word keeps its birth across
     * Markdown re-parses that renumber ordinals. A count at or below the
     * high-water mark is a no-op: StrictMode double renders repeat the
     * same count, and append-only growth can SHRINK the rendered count
     * (emphasis/link syntax closing) — offset keys make that harmless.
     */
    noteCommit(
      blockKey: string,
      revealedWordCount: number,
      nowMs: number
    ): void {
      const block = ensure(blockKey)
      if (revealedWordCount <= block.highWaterCount) return
      const newWords = revealedWordCount - block.highWaterCount
      const gap =
        block.lastCommitAtMs >= 0 ? nowMs - block.lastCommitAtMs : 0
      block.paceMs = Math.min(
        MAX_STAGGER_MS,
        Math.max(MIN_STAGGER_MS, gap / newWords)
      )
      block.birthCapMs = nowMs + gap + FADE_MS
      // Snapped-in text (hidden tab, adoption, terminal flush, lag jump)
      // renders already revealed: this commit's births back-date past the
      // fade so no animation queues. Later commits fade normally.
      block.backdateBirths = snapPending
      snapPending = false
      block.highWaterCount = revealedWordCount
      block.lastCommitAtMs = nowMs
    },

    /**
     * Marks the NEXT commit's new words as born already-revealed. Called by
     * the reveal hook when displayed text snaps straight to canonical —
     * snapped text must never queue fades.
     */
    snap(): void {
      snapPending = true
    },

    /**
     * Style per `(blockKey, wordKey)`. A word's first read assigns its
     * birth — chained `pace` after the previously assigned word, based at
     * the commit time, clamped to the birth cap. In-flight styles are
     * frozen (a rewritten `animation-delay` restarts the animation on a
     * live node); once the fade window elapses the entry UPGRADES to the
     * terminal revealed style — a finished animation sits at opacity 1
     * either way, and the upgrade is what lets the plugin unwrap elapsed
     * words and keeps a late-remounted span from replaying an old phase.
     */
    styleFor(
      blockKey: string,
      wordKey: number,
      nowMs: number
    ): StreamFadeStyle {
      const block = ensure(blockKey)
      const cached = block.styles.get(wordKey)
      if (cached) {
        if (!cached.style) return cached // terminal: revealed is permanent
        const birth = block.births.get(wordKey) ?? nowMs
        if (nowMs - birth < FADE_MS) return cached // in flight: frozen
        block.styles.set(wordKey, REVEALED_STYLE)
        return REVEALED_STYLE
      }
      let birth = block.births.get(wordKey)
      if (birth === undefined) {
        const commitBase =
          block.lastCommitAtMs >= 0 ? block.lastCommitAtMs : nowMs
        if (block.backdateBirths) {
          birth = nowMs - FADE_MS
          block.lastAssignedBirthMs = commitBase
        } else {
          const cap =
            block.birthCapMs >= 0 ? block.birthCapMs : nowMs + FADE_MS
          birth = Math.min(
            cap,
            Math.max(block.lastAssignedBirthMs + block.paceMs, commitBase)
          )
          block.lastAssignedBirthMs = birth
        }
        block.births.set(wordKey, birth)
      }
      const elapsed = nowMs - birth
      const result: StreamFadeStyle =
        elapsed >= FADE_MS
          ? REVEALED_STYLE
          : Object.freeze({
              className: "stream-word" as const,
              style: Object.freeze({
                animationDelay: `${Math.round(-elapsed)}ms`,
              }),
            })
      block.styles.set(wordKey, result)
      return result
    },

    /** Drops every block's data except the live one (terminal-block advance
     * or message reset). `null` drops everything. */
    prune(liveBlockKey: string | null): void {
      for (const key of blocks.keys()) {
        if (key !== liveBlockKey) blocks.delete(key)
      }
    },
  }
}

/** Elements whose subtrees must never receive fade spans. */
const SKIP_TAGS = new Set(["pre", "code", "table", "svg", "style", "script"])

function hasKatexClass(node: Element): boolean {
  const className = node.properties?.className
  const classes = Array.isArray(className)
    ? className
    : typeof className === "string"
      ? className.split(" ")
      : []
  return classes.some(
    (value) => typeof value === "string" && value.startsWith("katex")
  )
}

function shouldSkip(node: Element): boolean {
  return SKIP_TAGS.has(node.tagName) || hasKatexClass(node)
}

let cachedSegmenter: Intl.Segmenter | undefined
function wordSegmenter(): Intl.Segmenter {
  cachedSegmenter ??= new Intl.Segmenter(undefined, { granularity: "word" })
  return cachedSegmenter
}

/** Depth-first, document-order visit of wrappable text nodes. */
function visitTextNodes(
  parent: Parents,
  visit: (parent: Parents, node: Text, index: number) => void
): void {
  for (let index = 0; index < parent.children.length; index++) {
    const child = parent.children[index]
    if (child.type === "text") {
      visit(parent, child, index)
    } else if (child.type === "element" && !shouldSkip(child)) {
      visitTextNodes(child, visit)
    }
  }
}

function countWords(value: string): number {
  let count = 0
  for (const segment of wordSegmenter().segment(value)) {
    if (/\S/.test(segment.segment)) count++
  }
  return count
}

/**
 * Wraps the word segments of one block's text nodes in fade spans — but
 * ONLY words whose fade is in flight or scheduled. Words whose fade has
 * already elapsed render as plain text (merged with whitespace), so the
 * span count is bounded by the births of the last fade window + the birth
 * cap, independent of block length. Whitespace stays plain text
 * (selection/copy fidelity).
 *
 * Word identity is the SOURCE OFFSET of the word's text node plus the
 * segment offset within it — stable under append-only growth even when a
 * re-parse restructures the tree (closing `**hello**` moves "hello" into a
 * <strong> but keeps its source offset), so a remounted word resumes its
 * own fade instead of inheriting a renumbered neighbor's. Position-less
 * nodes (plugin-synthesized) fall back to a document-order ordinal in a
 * disjoint negative key space.
 */
export function rehypeStreamFade(options: {
  runtime: StreamFadeRuntime
  blockKey: string
}): (tree: Root) => void {
  const { runtime, blockKey } = options
  return (tree) => {
    const nowMs =
      typeof performance !== "undefined" ? performance.now() : Date.now()

    let totalWords = 0
    visitTextNodes(tree, (_parent, node) => {
      totalWords += countWords(node.value)
    })
    runtime.noteCommit(blockKey, totalWords, nowMs)

    let fallbackOrdinal = 0
    const replacements = new Map<Parents, Map<number, ElementContent[]>>()
    visitTextNodes(tree, (parent, node, index) => {
      const nodeOffset = node.position?.start?.offset
      const pieces: ElementContent[] = []
      let hasSpan = false
      const pushText = (value: string) => {
        const last = pieces[pieces.length - 1]
        if (last && last.type === "text") {
          last.value += value
        } else {
          pieces.push({ type: "text", value })
        }
      }
      for (const segment of wordSegmenter().segment(node.value)) {
        if (!/\S/.test(segment.segment)) {
          pushText(segment.segment)
          continue
        }
        const wordKey =
          nodeOffset !== undefined
            ? nodeOffset + segment.index
            : -(++fallbackOrdinal)
        const style = runtime.styleFor(blockKey, wordKey, nowMs)
        if (!style.style) {
          // Fade already elapsed: plain text, no span retained.
          pushText(segment.segment)
          continue
        }
        hasSpan = true
        pieces.push({
          type: "element",
          tagName: "span",
          properties: {
            className: style.className.split(" "),
            style: `animation-delay:${style.style.animationDelay}`,
          },
          children: [{ type: "text", value: segment.segment }],
        })
      }
      if (!hasSpan) return
      let byIndex = replacements.get(parent)
      if (!byIndex) {
        byIndex = new Map()
        replacements.set(parent, byIndex)
      }
      byIndex.set(index, pieces)
    })

    for (const [parent, byIndex] of replacements) {
      const next: ElementContent[] = []
      for (let index = 0; index < parent.children.length; index++) {
        const pieces = byIndex.get(index)
        if (pieces) {
          next.push(...pieces)
        } else {
          next.push(parent.children[index] as ElementContent)
        }
      }
      parent.children = next
    }
  }
}
