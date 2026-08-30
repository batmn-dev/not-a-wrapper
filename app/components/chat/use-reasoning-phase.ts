"use client"

import { useBrowserLayoutEffect } from "@/app/hooks/use-browser-layout-effect"
import type { ReasoningView } from "@/lib/chat-messages/assistant-turn"
import { toCompletedDurationSeconds } from "@/lib/format-duration"
import { useState } from "react"

export type AssistantWorkDuration = {
  durationMs: number | undefined
  durationSeconds: number | undefined
}

export type ReasoningPhase = {
  phase: "idle" | "thinking" | "complete"
  reasoningText: string
  durationMs: number | undefined
  durationSeconds: number | undefined
  isReasoningStreaming: boolean
  isOpaqueReasoning: boolean
}

type UseAssistantWorkDurationParams = {
  /** Server terminal authority, including a frozen approval-pause segment. */
  persistedWorkDurationMs: number | undefined
  /** True for the entire provider generation, not just reasoning blocks. */
  isActive: boolean
  /** An approval pause resumes the same accumulated assistant-work clock. */
  isPaused: boolean
  /**
   * Identity of the turn `reasoning` derives from. The panel's single hook
   * instance re-targets across turns (default-follow, explicit selection); a
   * key change is a turn HANDOFF and always restarts the timer from 0. Resume
   * behavior applies only within one turn's isLast bounce.
   */
  turnKey: string | undefined
}

type TimerState = {
  turnKey: string | undefined
  wasActive: boolean
  wasPaused: boolean
  displayMs: number
  frozenMs: number
}

/**
 * The single chat-owned assistant-work timer. The file name is retained to
 * avoid a destructive rename, but the clock now spans reasoning, tools,
 * searches, continuations, and answer generation. It pauses only while the
 * generation itself is paused (for example, awaiting approval).
 */
export function useAssistantWorkDuration({
  persistedWorkDurationMs,
  isActive,
  isPaused,
  turnKey,
}: UseAssistantWorkDurationParams): AssistantWorkDuration {
  const [timerState, setTimerState] = useState<TimerState>(() => ({
    turnKey,
    wasActive: isActive,
    wasPaused: isPaused,
    displayMs: persistedWorkDurationMs ?? 0,
    frozenMs: persistedWorkDurationMs ?? 0,
  }))

  const shouldRunTimer = isActive && !isPaused

  // React 19 render-sync: restart the timer on a turn handoff. The phase
  // transition below cannot catch every handoff — the swap may render before
  // `isLast` settles, or never transition phase at all (thinking→thinking) —
  // and either way the same-turn anchor would inherit the previous turn's ticks
  // (e.g. a panel header resuming a settled turn's 9s under a new turn).
  if (turnKey !== timerState.turnKey) {
    setTimerState({
      turnKey,
      wasActive: isActive,
      wasPaused: isPaused,
      displayMs: persistedWorkDurationMs ?? 0,
      frozenMs: persistedWorkDurationMs ?? 0,
    })
  } else if (
    isActive !== timerState.wasActive ||
    isPaused !== timerState.wasPaused
  ) {
    const authoritativeBase = persistedWorkDurationMs ?? 0
    const nextBase = Math.max(timerState.frozenMs, authoritativeBase)
    setTimerState({
      turnKey,
      wasActive: isActive,
      wasPaused: isPaused,
      displayMs: nextBase,
      frozenMs: nextBase,
    })
  }

  const tickedMs = timerState.turnKey === turnKey ? timerState.displayMs : 0

  // The elapsed time used to anchor a new interval. Read by the effect below
  // but intentionally kept out of its deps — see the note on the dep array.
  const frozenMs = timerState.turnKey === turnKey ? timerState.frozenMs : 0

  // Tick every second while thinking.
  useBrowserLayoutEffect(() => {
    if (!shouldRunTimer) return

    // Anchor to the already accumulated work so approval resume and transient
    // liveness bounces never regress the displayed elapsed time.
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
    //
    // `frozenMs` is deliberately NOT a dep: it only changes alongside a
    // `shouldRunTimer`/`turnKey` transition (the render-sync branches) or via
    // this cleanup's own freeze write. Depending on it turns that freeze write
    // into a teardown trigger — cleanup → setState(frozenMs) → deps changed →
    // cleanup — an infinite layout-effect loop (max update depth) as long as
    // Date.now() keeps advancing between commits. Every setup that needs a
    // fresh anchor is already forced by the remaining deps.
  }, [shouldRunTimer, turnKey])

  // Live shows the estimate, settled shows the truth: while the turn runs (or
  // is paused awaiting approval) the local ticker owns the label; once the
  // turn settles, the persisted server total owns it — never blended, so the
  // settled label is identical in-session, after reload, and as history. The
  // ticker remains the fallback for settled turns with no persisted total
  // (aborts/failures that never wrote metadata).
  const tickedFallbackMs = tickedMs > 0 ? tickedMs : undefined
  const durationMs =
    isActive || isPaused
      ? tickedFallbackMs
      : (persistedWorkDurationMs ?? tickedFallbackMs)
  const durationSeconds = toCompletedDurationSeconds(durationMs)

  return {
    durationMs,
    durationSeconds,
  }
}

type ReasoningTimerState = {
  turnKey: string | undefined
  phase: ReasoningView["phase"]
  displayMs: number
  frozenMs: number
}

/**
 * Reasoning-only interval timer retained alongside the continuous work clock.
 * It pauses across tools/gaps and hands off to server reasoningDurationMs.
 */
export function useReasoningPhase({
  reasoning,
  isLast,
  turnKey,
}: {
  reasoning: ReasoningView
  isLast: boolean
  turnKey: string | undefined
}): ReasoningPhase {
  // Seed from the persisted total (mirrors the work clock) so an approval
  // continuation mounted fresh — reload, second device — resumes the ticker
  // from the pre-pause reasoning time instead of 0.
  const [timerState, setTimerState] = useState<ReasoningTimerState>(() => ({
    turnKey,
    phase: reasoning.phase,
    displayMs: reasoning.persistedDurationMs ?? 0,
    frozenMs: reasoning.persistedDurationMs ?? 0,
  }))
  const shouldRunTimer = isLast && reasoning.isStreaming

  if (turnKey !== timerState.turnKey) {
    setTimerState({
      turnKey,
      phase: reasoning.phase,
      displayMs: reasoning.persistedDurationMs ?? 0,
      frozenMs: reasoning.persistedDurationMs ?? 0,
    })
  } else if (reasoning.phase !== timerState.phase) {
    const enteringFirstReasoning =
      reasoning.phase === "thinking" && timerState.phase === "idle"
    setTimerState({
      turnKey,
      phase: reasoning.phase,
      displayMs: enteringFirstReasoning ? 0 : timerState.displayMs,
      frozenMs: enteringFirstReasoning ? 0 : timerState.frozenMs,
    })
  }

  const tickedMs = timerState.turnKey === turnKey ? timerState.displayMs : 0
  const frozenMs = timerState.turnKey === turnKey ? timerState.frozenMs : 0

  useBrowserLayoutEffect(() => {
    if (!shouldRunTimer) return
    const activeTurnKey = turnKey
    const startedAt = Date.now() - frozenMs
    const interval = setInterval(() => {
      const elapsedMs = Math.max(0, Date.now() - startedAt)
      setTimerState((current) =>
        current.turnKey === activeTurnKey
          ? { ...current, displayMs: elapsedMs }
          : current
      )
    }, 1000)
    return () => {
      clearInterval(interval)
      const elapsedMs = Math.max(0, Date.now() - startedAt)
      setTimerState((current) =>
        current.turnKey === activeTurnKey
          ? { ...current, displayMs: elapsedMs, frozenMs: elapsedMs }
          : current
      )
    }
    // `frozenMs` is deliberately NOT a dep — same feedback-loop hazard as the
    // work clock above: the cleanup writes frozenMs, so listing it re-triggers
    // the cleanup indefinitely. Re-anchoring is covered by the remaining deps.
  }, [shouldRunTimer, turnKey])

  // Same contract as the work clock: the ticker owns the label only while
  // reasoning is literally streaming; otherwise the persisted server total
  // does (with the frozen ticker as fallback for mid-turn gaps and turns that
  // never persisted a total).
  const persistedDurationMs = reasoning.persistedDurationMs
  const tickedFallbackMs = tickedMs > 0 ? tickedMs : undefined
  const durationMs = reasoning.isStreaming
    ? tickedFallbackMs
    : (persistedDurationMs ?? tickedFallbackMs)

  return {
    phase: reasoning.phase,
    reasoningText: reasoning.text,
    durationMs,
    durationSeconds: toCompletedDurationSeconds(durationMs),
    isReasoningStreaming: reasoning.isStreaming,
    isOpaqueReasoning: reasoning.isOpaque,
  }
}
