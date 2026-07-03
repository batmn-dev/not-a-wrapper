"use client"

import type { ReasoningView } from "@/lib/chat-messages/assistant-turn"
import { useEffect, useRef, useState } from "react"

export type ReasoningPhase = {
  phase: "idle" | "thinking" | "complete"
  reasoningText: string
  durationSeconds: number | undefined
  isReasoningStreaming: boolean
  isOpaqueReasoning: boolean
}

type UseReasoningPhaseParams = {
  /** The pure reasoning derivation from the Assistant turn view. */
  reasoning: ReasoningView
  isLast: boolean
  /**
   * Identity of the turn `reasoning` derives from. The panel's single hook
   * instance re-targets across turns (default-follow, explicit selection); a
   * key change is a turn HANDOFF and always restarts the timer from 0. The R1
   * resume applies only within one turn's isLast bounce.
   */
  turnKey: string | undefined
}

/**
 * The stateful remainder of the reasoning derivation: the live "thinking"
 * timer. Everything pure (phase, text, opacity, persisted duration) moved to
 * `deriveReasoningView` in lib/chat-messages/assistant-turn.ts — this hook
 * consumes that view and owns only the tick/freeze/resume timer semantics.
 */
export function useReasoningPhase({
  reasoning,
  isLast,
  turnKey,
}: UseReasoningPhaseParams): ReasoningPhase {
  const { phase, text: reasoningText, isOpaque, persistedDurationMs } =
    reasoning

  // Client-side timer.
  // React 19 render-sync pattern: reset tickedSeconds when entering thinking.
  // The interval in useEffect ticks every second while shouldRunTimer is true.
  // When phase leaves "thinking", the interval stops and tickedSeconds
  // holds the frozen final value.
  const startTimestampRef = useRef<number | null>(null)
  const [tickedSeconds, setTickedSeconds] = useState(0)
  const [prevPhase, setPrevPhase] = useState(phase)
  const [prevTurnKey, setPrevTurnKey] = useState(turnKey)

  // Mirror the live tick count in a ref (synced in an effect, never during
  // render) so the timer effect can resume from the accumulated elapsed time
  // without listing `tickedSeconds` as a dependency — which would restart the
  // interval every second (R1).
  const tickedSecondsRef = useRef(tickedSeconds)
  useEffect(() => {
    tickedSecondsRef.current = tickedSeconds
  }, [tickedSeconds])

  const shouldRunTimer = isLast && phase === "thinking"

  // React 19 render-sync: restart the timer on a turn handoff. The phase
  // transition below cannot catch every handoff — the swap may render before
  // `isLast` settles, or never transition phase at all (thinking→thinking) —
  // and either way the R1 anchor would inherit the previous turn's ticks
  // (e.g. a panel header resuming a settled turn's 9s under a new turn).
  if (turnKey !== prevTurnKey) {
    setPrevTurnKey(turnKey)
    setPrevPhase(phase)
    setTickedSeconds(0)
  } else if (phase !== prevPhase) {
    // Reset timer state when entering thinking phase. This fires only on a
    // genuine phase transition into "thinking" (idle/complete → thinking),
    // e.g. a same-turn regenerate — never during an isLast bounce where the
    // phase stays "thinking".
    setPrevPhase(phase)
    if (phase === "thinking" && isLast) {
      setTickedSeconds(0)
    }
  }

  // Tick every second while thinking.
  useEffect(() => {
    if (!shouldRunTimer) return

    // R1: anchor the wall clock to the already-accumulated elapsed time so a
    // same-turn `isLast` true→false→true bounce (while the phase stays
    // "thinking") RESUMES the timer instead of restarting it from 0 —
    // `tickedSeconds` must never regress mid-stream. On a fresh "thinking"
    // entry or a turn handoff the render-sync resets above have already
    // zeroed `tickedSeconds` (the mirror effect runs before this one), so
    // `start` collapses to `Date.now()`.
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
    // `turnKey` is a dep so a handoff that keeps `shouldRunTimer` true
    // (thinking→thinking swap) tears down the old turn's interval and
    // re-anchors — the render-sync reset alone can't stop a running interval
    // still anchored to the previous turn.
  }, [shouldRunTimer, turnKey])

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
    isOpaqueReasoning: isOpaque,
  }
}
