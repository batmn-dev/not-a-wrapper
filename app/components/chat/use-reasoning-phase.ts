"use client"

import type { UIMessage } from "@ai-sdk/react"
import { useEffect, useRef, useState } from "react"

export type ReasoningPhase = {
  phase: "idle" | "thinking" | "complete"
  reasoningText: string
  durationSeconds: number | undefined
  isReasoningStreaming: boolean
  isOpaqueReasoning: boolean
}

type UseReasoningPhaseParams = {
  parts: UIMessage["parts"] | undefined
  status: "streaming" | "ready" | "submitted" | "error"
  isLast: boolean
  /** Server-persisted reasoning duration in ms (from messageMetadata). */
  persistedDurationMs?: number
}

export function useReasoningPhase({
  parts,
  status,
  isLast,
  persistedDurationMs,
}: UseReasoningPhaseParams): ReasoningPhase {
  // Derive phase and text from parts on every render.
  // AI SDK can mutate part objects in place during streaming without
  // changing the array reference, so memoizing by `parts` can miss updates.
  const reasoningParts = parts?.filter((p) => p.type === "reasoning") ?? []

  let phase: ReasoningPhase["phase"] = "idle"
  let reasoningText = ""

  if (reasoningParts.length > 0) {
    const text = reasoningParts.map((p) => p.text).join("\n\n")

    const isAnyStreaming = reasoningParts.some(
      (p) => (p as { state?: string }).state === "streaming"
    )

    if (isAnyStreaming) {
      phase = "thinking"
      reasoningText = text
    } else {
      const isAnyDone = reasoningParts.some(
        (p) => (p as { state?: string }).state === "done"
      )

      if (isAnyDone || status === "ready" || status === "error") {
        phase = "complete"
        reasoningText = text
      } else if (text.trim()) {
        phase = "complete"
        reasoningText = text
      } else {
        phase = "thinking"
        reasoningText = ""
      }
    }
  }

  const isOpaqueReasoning = phase !== "idle" && !reasoningText.trim()

  // Client-side timer.
  // React 19 render-sync pattern: reset tickedSeconds when entering thinking.
  // The interval in useEffect ticks every second while shouldRunTimer is true.
  // When phase leaves "thinking", the interval stops and tickedSeconds
  // holds the frozen final value.
  const startTimestampRef = useRef<number | null>(null)
  const [tickedSeconds, setTickedSeconds] = useState(0)
  const [prevPhase, setPrevPhase] = useState(phase)

  // Mirror the live tick count in a ref (synced in an effect, never during
  // render) so the timer effect can resume from the accumulated elapsed time
  // without listing `tickedSeconds` as a dependency — which would restart the
  // interval every second (R1).
  const tickedSecondsRef = useRef(tickedSeconds)
  useEffect(() => {
    tickedSecondsRef.current = tickedSeconds
  }, [tickedSeconds])

  const shouldRunTimer = isLast && phase === "thinking"

  // React 19 render-sync: reset timer state when entering thinking phase. This
  // fires only on a genuine phase transition into "thinking" (idle/complete →
  // thinking), e.g. a fresh turn or regenerate handoff — never during an
  // isLast bounce where the phase stays "thinking".
  if (phase !== prevPhase) {
    setPrevPhase(phase)
    if (phase === "thinking" && isLast) {
      setTickedSeconds(0)
    }
  }

  // Tick every second while thinking.
  useEffect(() => {
    if (!shouldRunTimer) return

    // R1: anchor the wall clock to the already-accumulated elapsed time so a
    // same-id `isLast` true→false→true bounce (e.g. regenerate handoff, while
    // the phase stays "thinking") RESUMES the timer instead of restarting it
    // from 0 — `tickedSeconds` must never regress mid-stream. On a genuine
    // fresh "thinking" entry the render-sync reset above has already zeroed
    // `tickedSeconds`, so `start` collapses to `Date.now()` (unchanged).
    const start = Date.now() - tickedSecondsRef.current * 1000
    startTimestampRef.current = start

    const interval = setInterval(() => {
      setTickedSeconds(Math.round((Date.now() - start) / 1000))
    }, 1000)

    return () => {
      clearInterval(interval)
      // Freeze final value on cleanup
      if (startTimestampRef.current !== null) {
        setTickedSeconds(
          Math.round((Date.now() - startTimestampRef.current) / 1000)
        )
        startTimestampRef.current = null
      }
    }
  }, [shouldRunTimer])

  // Compute final durationSeconds.
  // Priority: live timer (last message) > server-persisted duration (historical)
  let durationSeconds: number | undefined

  if (isLast && (phase === "thinking" || phase === "complete")) {
    if (tickedSeconds > 0) {
      durationSeconds = tickedSeconds
    } else if (phase === "complete" && persistedDurationMs !== undefined) {
      durationSeconds = Math.round(persistedDurationMs / 1000)
    } else {
      durationSeconds = undefined
    }
  } else if (persistedDurationMs !== undefined) {
    durationSeconds = Math.round(persistedDurationMs / 1000)
  } else {
    durationSeconds = undefined
  }

  return {
    phase,
    reasoningText,
    durationSeconds,
    isReasoningStreaming: phase === "thinking",
    isOpaqueReasoning,
  }
}
