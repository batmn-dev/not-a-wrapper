"use client"

import { useBrowserLayoutEffect } from "@/app/hooks/use-browser-layout-effect"
import type { ReasoningView } from "@/lib/chat-messages/assistant-turn"
import { toCompletedDurationSeconds } from "@/lib/format-duration"
import { useState } from "react"

export type ReasoningPhase = {
  phase: "idle" | "thinking" | "complete"
  reasoningText: string
  durationMs: number | undefined
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
  displayMs: number
  frozenMs: number
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
  // The browser layout-sync interval ticks while shouldRunTimer is true.
  // When phase leaves "thinking", the interval stops and freezes the final
  // value into the state used by the next resume.
  const [timerState, setTimerState] = useState<TimerState>(() => ({
    turnKey,
    phase,
    displayMs: 0,
    frozenMs: 0,
  }))

  const shouldRunTimer = isLast && reasoning.isStreaming

  // React 19 render-sync: restart the timer on a turn handoff. The phase
  // transition below cannot catch every handoff — the swap may render before
  // `isLast` settles, or never transition phase at all (thinking→thinking) —
  // and either way the R1 anchor would inherit the previous turn's ticks
  // (e.g. a panel header resuming a settled turn's 9s under a new turn).
  if (turnKey !== timerState.turnKey) {
    setTimerState({
      turnKey,
      phase,
      displayMs: 0,
      frozenMs: 0,
    })
  } else if (phase !== timerState.phase) {
    // Reset timer state when entering thinking phase. This fires only on a
    // genuine phase transition into "thinking" (idle/complete → thinking),
    // e.g. a same-turn regenerate — never during an isLast bounce where the
    // phase stays "thinking".
    const resetElapsed = phase === "thinking" && isLast
    setTimerState({
      turnKey,
      phase,
      displayMs: resetElapsed ? 0 : timerState.displayMs,
      frozenMs: resetElapsed ? 0 : timerState.frozenMs,
    })
  }

  const tickedMs = timerState.turnKey === turnKey ? timerState.displayMs : 0

  // The elapsed time used to anchor a new interval changes only when the timer
  // stops/resumes or is synchronously reset. It does not change on every tick,
  // so it is safe to depend on without restarting the interval every second.
  const frozenMs = timerState.turnKey === turnKey ? timerState.frozenMs : 0

  // Tick every second while thinking.
  useBrowserLayoutEffect(() => {
    if (!shouldRunTimer) return

    // R1: anchor the wall clock to the already-accumulated elapsed time so a
    // same-turn `isLast` true→false→true bounce (while the phase stays
    // "thinking") RESUMES the timer instead of restarting it from 0 —
    // elapsed milliseconds must never regress mid-stream. On a fresh "thinking"
    // entry or a turn handoff the render-sync resets above have already
    // zeroed `frozenMs`, so `start` collapses to `Date.now()`.
    const activeTurnKey = turnKey
    const start = Date.now() - frozenMs

    const interval = setInterval(() => {
      const elapsedMs = Math.max(0, Date.now() - start)
      setTimerState((current) =>
        current.turnKey === activeTurnKey
          ? {
              ...current,
              displayMs: elapsedMs,
            }
          : current
      )
    }, 1000)

    return () => {
      clearInterval(interval)
      const elapsedMs = Math.max(0, Date.now() - start)
      // Same-turn stop/resume freezes elapsed time. A turn handoff has already
      // synchronously changed timerState.turnKey, so stale cleanup from the
      // previous turn is ignored without touching refs during render.
      setTimerState((current) =>
        current.turnKey === activeTurnKey
          ? {
              ...current,
              displayMs: elapsedMs,
              frozenMs: elapsedMs,
            }
          : current
      )
    }
    // `turnKey` is a dep so a handoff that keeps `shouldRunTimer` true
    // (thinking→thinking swap) tears down the old turn's interval and
    // re-anchors — the render-sync reset alone can't stop a running interval
    // still anchored to the previous turn.
  }, [frozenMs, shouldRunTimer, turnKey])

  // Persisted duration is terminal authority. Before finish metadata arrives,
  // retain the current session's monotonic handoff so settlement never flashes
  // backward or loses its elapsed value.
  const durationMs =
    phase === "complete" && persistedDurationMs !== undefined
      ? persistedDurationMs
      : tickedMs > 0
        ? tickedMs
        : persistedDurationMs
  const durationSeconds = toCompletedDurationSeconds(durationMs)

  return {
    phase,
    reasoningText,
    durationMs,
    durationSeconds,
    isReasoningStreaming: reasoning.isStreaming,
    isOpaqueReasoning: isOpaque,
  }
}
