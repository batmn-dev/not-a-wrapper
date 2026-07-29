import type { StreamTextTransform, TextStreamPart, ToolSet } from "ai"

/**
 * Word-granular re-chunking of coarse provider text deltas — the ADR-0016
 * "provider smoothing" escape hatch, implemented at the server stream seam.
 *
 * Evidence (docs/adr/0016-streaming-rendering-architecture.md, "Provider
 * smoothing"): Anthropic's serving path emits ~90–430-char text deltas every
 * ~100–400 ms, which the client faithfully paints as slabs; OpenAI's emits
 * word-granular deltas that need nothing. Instead of a provider allowlist that
 * rots as the model catalog changes, the gate is the evidence itself:
 * a delta at or below the pass-through threshold is forwarded untouched and
 * synchronously (zero cost, zero added latency for already-fine providers),
 * and only oversized slabs are split into whitespace-attached word deltas.
 *
 * The §9 corrections to the retracted `smoothStream` proposal are the design
 * constraints here:
 *
 *  - TEXT ONLY. Every non-`text-delta` part (reasoning deltas included)
 *    passes through immediately. Ordering is preserved by one internal drain
 *    queue; `flush` waits for that queue before the stream closes.
 *  - BOUNDED LAG. Pacing is adaptive, not fixed: each slab is spread over at
 *    most ~90% of the provider's actual observed inter-delta gap (capped at
 *    MAX_SPREAD_MS), so emission never falls cumulatively behind the wire and
 *    total added latency stays below one provider gap. The first oversized
 *    slab gets a small floor; later slabs arriving within that floor are
 *    already a burst and drain without another pacing delay.
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
/** Initial floor and steady-state ceiling for the per-slab spread budget. */
const MIN_SPREAD_MS = 40
const MAX_SPREAD_MS = 360
/** Fraction of the observed inter-delta gap a slab may spend draining. */
const SPREAD_FRACTION = 0.9

/** Split into whitespace-attached word chunks; concatenation is identity. */
export function splitIntoWordChunks(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [text]
}

export function createWordChunkingTransform<TOOLS extends ToolSet>(
  abortSignal?: AbortSignal
): StreamTextTransform<TOOLS> {
  return () => {
    let cancelled = false
    let lastDeltaArrivedAtMs: number | null = null
    let hasPacedSlab = false
    let wake: (() => void) | null = null
    const pending: {
      part: TextStreamPart<TOOLS>
      arrivedAtMs: number
    }[] = []
    let drainPromise: Promise<void> | null = null
    let abortListenerAttached = false
    let streamController:
      TransformStreamDefaultController<TextStreamPart<TOOLS>> | undefined

    const removeAbortListener = () => {
      if (!abortListenerAttached || !abortSignal) return
      abortSignal.removeEventListener("abort", handleExecutionAbort)
      abortListenerAttached = false
    }

    const cancelDrain = (emitAbort: boolean) => {
      if (cancelled) return
      cancelled = true
      pending.length = 0
      wake?.()
      removeAbortListener()
      if (emitAbort && streamController) {
        // The provider may already have filled streamText's upstream queue
        // while this transform is still pacing. In that state AI SDK's own
        // abort observer has no remaining upstream pull on which to emit its
        // abort part, so this transform must terminalize its delayed output
        // explicitly instead of closing as a successful completion.
        streamController.enqueue({
          type: "abort",
          reason: "stream aborted",
        })
        streamController.terminate()
      }
    }

    const handleExecutionAbort = () => cancelDrain(true)

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

    const drain = async (
      controller: TransformStreamDefaultController<TextStreamPart<TOOLS>>
    ) => {
      while (!cancelled) {
        const next = pending.shift()
        if (!next) return

        const { part, arrivedAtMs } = next
        if (part.type !== "text-delta") {
          controller.enqueue(part)
          continue
        }

        const gapMs =
          lastDeltaArrivedAtMs === null ? 0 : arrivedAtMs - lastDeltaArrivedAtMs
        lastDeltaArrivedAtMs = arrivedAtMs

        if (part.text.length <= PASSTHROUGH_MAX_CHARS) {
          controller.enqueue(part)
          continue
        }

        const words = splitIntoWordChunks(part.text)
        const spreadMs = !hasPacedSlab
          ? MIN_SPREAD_MS
          : gapMs <= MIN_SPREAD_MS
            ? 0
            : Math.min(MAX_SPREAD_MS, gapMs * SPREAD_FRACTION)
        hasPacedSlab = true
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
      }
    }

    const ensureDrain = (
      controller: TransformStreamDefaultController<TextStreamPart<TOOLS>>
    ) => {
      if (drainPromise || cancelled) return
      drainPromise = drain(controller).finally(() => {
        drainPromise = null
        if (pending.length > 0 && !cancelled) ensureDrain(controller)
      })
    }

    // `cancel` is part of the runtime Transformer contract (invoked when the
    // readable side is cancelled — Stop, error, stopStream) but predates this
    // TS lib's Transformer type; the widened local type keeps it checked.
    const transformer: Transformer<
      TextStreamPart<TOOLS>,
      TextStreamPart<TOOLS>
    > & { cancel: () => void } = {
      start(controller) {
        streamController = controller
        if (!abortSignal) return
        if (abortSignal.aborted) {
          handleExecutionAbort()
          return
        }
        abortSignal.addEventListener("abort", handleExecutionAbort, {
          once: true,
        })
        abortListenerAttached = true
      },

      transform(part, controller) {
        if (cancelled) return
        pending.push({ part, arrivedAtMs: Date.now() })
        ensureDrain(controller)
      },

      async flush() {
        try {
          while (drainPromise) await drainPromise
        } finally {
          removeAbortListener()
        }
      },

      cancel() {
        cancelDrain(false)
      },
    }

    return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>(
      transformer
    )
  }
}
