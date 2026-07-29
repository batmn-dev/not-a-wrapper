import type { StreamTextTransform, TextStreamPart, ToolSet } from "ai"

/**
 * Word-granular re-chunking of coarse provider text deltas — the ADR-0016
 * "provider smoothing" escape hatch, implemented at the server stream seam.
 *
 * Evidence (docs/measurements/2026-07-28-streaming-failures-investigation.md,
 * issue 3): Anthropic's serving path emits ~90–430-char text deltas every
 * ~100–400 ms, which the client faithfully paints as slabs; OpenAI's emits
 * word-granular deltas that need nothing. Instead of a provider allowlist
 * that rots as the model catalog changes, the gate is the evidence itself:
 * a delta at or below the pass-through threshold is forwarded untouched and
 * synchronously (zero cost, zero added latency for already-fine providers),
 * and only oversized slabs are split into whitespace-attached word deltas.
 *
 * The §9 corrections to the retracted `smoothStream` proposal are the design
 * constraints here:
 *
 *  - TEXT ONLY. Every non-`text-delta` part (reasoning deltas included)
 *    passes through immediately. Ordering is preserved by construction: the
 *    transform awaits each slab's drain before accepting the next part, so
 *    there is no cross-part buffer and nothing to flush.
 *  - BOUNDED LAG. Pacing is adaptive, not fixed: each slab is spread over at
 *    most ~90% of the provider's own observed inter-delta gap (clamped to
 *    [MIN_SPREAD_MS, MAX_SPREAD_MS]), so emission never falls cumulatively
 *    behind the wire and total added latency stays below one provider gap.
 *    A same-instant burst (gap ≈ 0) spreads over the floor only.
 *  - ABORT-AWARE. Delays resolve immediately on cancellation (Stop, error,
 *    `stopStream`), the remaining words of the in-flight slab are dropped,
 *    and no timer outlives the stream. What was emitted is what onChunk saw,
 *    so displayed == canonical == durable at every terminal.
 *
 * The durable snapshot tracker consumes the transformed stream (user
 * transforms pipe before the event processor that invokes `onChunk`), so it
 * sees identical content at its own unchanged 750 ms write throttle.
 */

/** Deltas at or below this length are forwarded untouched, synchronously. */
const PASSTHROUGH_MAX_CHARS = 24
/** Ceiling on per-word spacing — never reveal slower than this. */
const MAX_WORD_DELAY_MS = 24
/** Floor/ceiling on the per-slab spread budget derived from the provider gap. */
const MIN_SPREAD_MS = 40
const MAX_SPREAD_MS = 360
/** Fraction of the observed inter-delta gap a slab may spend draining. */
const SPREAD_FRACTION = 0.9

/** Split into whitespace-attached word chunks; concatenation is identity. */
export function splitIntoWordChunks(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [text]
}

export function createWordChunkingTransform<
  TOOLS extends ToolSet,
>(): StreamTextTransform<TOOLS> {
  return () => {
    let cancelled = false
    let lastDeltaAtMs: number | null = null
    let wake: (() => void) | null = null

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          wake = null
          resolve()
        }, ms)
        wake = () => {
          clearTimeout(timer)
          wake = null
          resolve()
        }
      })

    // `cancel` is part of the runtime Transformer contract (invoked when the
    // readable side is cancelled — Stop, error, stopStream) but predates this
    // TS lib's Transformer type; the widened local type keeps it checked.
    const transformer: Transformer<
      TextStreamPart<TOOLS>,
      TextStreamPart<TOOLS>
    > & { cancel: () => void } = {
      async transform(part, controller) {
        if (cancelled) return
        if (part.type !== "text-delta") {
          controller.enqueue(part)
          return
        }

        const now = Date.now()
        const gapMs = lastDeltaAtMs === null ? 0 : now - lastDeltaAtMs
        lastDeltaAtMs = now

        if (part.text.length <= PASSTHROUGH_MAX_CHARS) {
          controller.enqueue(part)
          return
        }

        const words = splitIntoWordChunks(part.text)
        const spreadMs = Math.min(
          MAX_SPREAD_MS,
          Math.max(MIN_SPREAD_MS, gapMs * SPREAD_FRACTION)
        )
        const perWordMs = Math.min(MAX_WORD_DELAY_MS, spreadMs / words.length)

        for (let index = 0; index < words.length; index++) {
          if (cancelled) return
          controller.enqueue({ ...part, text: words[index] })
          // No delay after the final word: the next arriving part (or the
          // stream end) should never wait behind an already-drained slab.
          if (perWordMs >= 1 && index < words.length - 1) {
            await sleep(perWordMs)
          }
        }
      },

      cancel() {
        cancelled = true
        wake?.()
      },
    }

    return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>(
      transformer
    )
  }
}
