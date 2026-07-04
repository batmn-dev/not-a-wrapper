"use client"

import type { ReasoningView } from "@/lib/chat-messages/assistant-turn"
import { useEffect, useState } from "react"

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

type TimerState = {
  turnKey: string | undefined
  phase: ReasoningView["phase"]
  displaySeconds: number
  frozenSeconds: number
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
  const {
    phase,
    text: reasoningText,
    isOpaque,
    persistedDurationMs,
  } = reasoning

  // Client-side timer.
  // React 19 render-sync pattern: reset timer state when entering thinking.
  // The interval in useEffect ticks every second while shouldRunTimer is true.
  // When phase leaves "thinking", the interval stops and freezes the final
  // value into the state used by the next resume.
  const [timerState, setTimerState] = useState<TimerState>(() => ({
    turnKey,
    phase,
    displaySeconds: 0,
    frozenSeconds: 0,
  }))

  const shouldRunTimer = isLast && phase === "thinking"

  // React 19 render-sync: restart the timer on a turn handoff. The phase
  // transition below cannot catch every handoff — the swap may render before
  // `isLast` settles, or never transition phase at all (thinking→thinking) —
  // and either way the R1 anchor would inherit the previous turn's ticks
  // (e.g. a panel header resuming a settled turn's 9s under a new turn).
  if (turnKey !== timerState.turnKey) {
    setTimerState({
      turnKey,
      phase,
      displaySeconds: 0,
      frozenSeconds: 0,
    })
  } else if (phase !== timerState.phase) {
    // Reset timer state when entering thinking phase. This fires only on a
    // genuine phase transition into "thinking" (idle/complete → thinking),
    // e.g. a same-turn regenerate — never during an isLast bounce where the
    // phase stays "thinking".
    const resetSeconds = phase === "thinking" && isLast
    setTimerState({
      turnKey,
      phase,
      displaySeconds: resetSeconds ? 0 : timerState.displaySeconds,
      frozenSeconds: resetSeconds ? 0 : timerState.frozenSeconds,
    })
  }

  const tickedSeconds =
    timerState.turnKey === turnKey ? timerState.displaySeconds : 0

  // The elapsed time used to anchor a new interval changes only when the timer
  // stops/resumes or is synchronously reset. It does not change on every tick,
  // so it is safe to depend on without restarting the interval every second.
  const frozenSeconds =
    timerState.turnKey === turnKey ? timerState.frozenSeconds : 0

  // Tick every second while thinking.
  useEffect(() => {
    if (!shouldRunTimer) return

    // R1: anchor the wall clock to the already-accumulated elapsed time so a
    // same-turn `isLast` true→false→true bounce (while the phase stays
    // "thinking") RESUMES the timer instead of restarting it from 0 —
    // `tickedSeconds` must never regress mid-stream. On a fresh "thinking"
    // entry or a turn handoff the render-sync resets above have already
    // zeroed `frozenSeconds`, so `start` collapses to `Date.now()`.
    const activeTurnKey = turnKey
    const start = Date.now() - frozenSeconds * 1000

    const interval = setInterval(() => {
      const elapsedSeconds = Math.round((Date.now() - start) / 1000)
      setTimerState((current) =>
        current.turnKey === activeTurnKey
          ? {
              ...current,
              displaySeconds: elapsedSeconds,
            }
          : current
      )
    }, 1000)

    return () => {
      clearInterval(interval)
      const elapsedSeconds = Math.round((Date.now() - start) / 1000)
      // Same-turn stop/resume freezes elapsed time. A turn handoff has already
      // synchronously changed timerState.turnKey, so stale cleanup from the
      // previous turn is ignored without touching refs during render.
      setTimerState((current) =>
        current.turnKey === activeTurnKey
          ? {
              ...current,
              displaySeconds: elapsedSeconds,
              frozenSeconds: elapsedSeconds,
            }
          : current
      )
    }
    // `turnKey` is a dep so a handoff that keeps `shouldRunTimer` true
    // (thinking→thinking swap) tears down the old turn's interval and
    // re-anchors — the render-sync reset alone can't stop a running interval
    // still anchored to the previous turn.
  }, [frozenSeconds, shouldRunTimer, turnKey])

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
