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
  wordCount: number
  lastCommitAtMs: number
  births: number[]
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
        wordCount: 0,
        lastCommitAtMs: -1,
        births: [],
        styles: new Map(),
      }
      blocks.set(blockKey, block)
    }
    return block
  }

  return {
    /**
     * Assigns monotonically chained births to the words revealed by this
     * commit. A count at or below the block's high-water mark is a no-op:
     * StrictMode double renders repeat the same count, and append-only
     * Markdown growth can SHRINK the rendered word count (emphasis/link
     * syntax characters vanish when their closer arrives) — resetting
     * births there would rewrite every span's delay and restart the whole
     * block's fades. Kept births are approximate for re-indexed words;
     * approximate phase is invisible, a mass restart is not.
     */
    noteCommit(
      blockKey: string,
      revealedWordCount: number,
      nowMs: number
    ): void {
      const block = ensure(blockKey)
      if (revealedWordCount <= block.wordCount) return
      if (snapPending) {
        // Snapped-in text (hidden tab, mid-stream adoption, terminal flush)
        // renders already revealed: births are back-dated past the fade so
        // no animation queues. Later appends fade normally.
        snapPending = false
        for (let i = block.wordCount; i < revealedWordCount; i++) {
          block.births[i] = nowMs - FADE_MS
        }
        block.wordCount = revealedWordCount
        block.lastCommitAtMs = nowMs
        return
      }
      const newWords = revealedWordCount - block.wordCount
      const gap =
        block.lastCommitAtMs >= 0 ? nowMs - block.lastCommitAtMs : 0
      const pace = Math.min(
        MAX_STAGGER_MS,
        Math.max(MIN_STAGGER_MS, gap / newWords)
      )
      const cap = nowMs + gap + FADE_MS
      for (let i = block.wordCount; i < revealedWordCount; i++) {
        const prevBirth = i > 0 ? (block.births[i - 1] ?? nowMs) : -Infinity
        block.births[i] = Math.min(cap, Math.max(prevBirth + pace, nowMs))
      }
      block.wordCount = revealedWordCount
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
     * Frozen-while-in-flight style per `(blockKey, wordIndex)`: an active
     * fade's `animation-delay` is never recomputed (a rewritten value
     * restarts the animation on a live node), but once the fade window has
     * elapsed the entry UPGRADES to the terminal revealed style — a
     * finished animation sits at opacity 1 either way, and the upgrade is
     * what lets the plugin unwrap elapsed words and keeps a late-remounted
     * span from replaying an old fade phase.
     */
    styleFor(
      blockKey: string,
      wordIndex: number,
      nowMs: number
    ): StreamFadeStyle {
      const block = ensure(blockKey)
      const cached = block.styles.get(wordIndex)
      if (cached) {
        if (!cached.style) return cached // terminal: revealed is permanent
        const birth = block.births[wordIndex] ?? nowMs
        if (nowMs - birth < FADE_MS) return cached // in flight: frozen
        block.styles.set(wordIndex, REVEALED_STYLE)
        return REVEALED_STYLE
      }
      let birth = block.births[wordIndex]
      if (birth === undefined) {
        // Unknown word (count drift): born now, recorded so the upgrade
        // check above has a birth to age against.
        birth = nowMs
        block.births[wordIndex] = birth
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
      block.styles.set(wordIndex, result)
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
 * (selection/copy fidelity). Word indexes run in document order across the
 * whole block, matching the counting pass that feeds `noteCommit`.
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

    let wordIndex = 0
    const replacements = new Map<Parents, Map<number, ElementContent[]>>()
    visitTextNodes(tree, (parent, node, index) => {
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
        const style = runtime.styleFor(blockKey, wordIndex++, nowMs)
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
