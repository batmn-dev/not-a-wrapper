export type WorkDurationTracker = {
  close: () => void
  getDurationMs: () => number
}

/**
 * Continuous assistant-work accounting for one provider-stream segment.
 *
 * The clock starts immediately before provider consumption and stops at the
 * first terminal generation signal. `initialDurationMs` carries prior active
 * work across an approval pause without counting the human wait between
 * provider streams.
 */
export function createWorkDurationTracker(options?: {
  initialDurationMs?: number
  now?: () => number
}): WorkDurationTracker {
  const now = options?.now ?? Date.now
  const initialDurationMs = Math.max(0, options?.initialDurationMs ?? 0)
  const startedAtMs = now()
  let stoppedAtMs: number | undefined

  return {
    close() {
      if (stoppedAtMs === undefined) stoppedAtMs = now()
    },
    getDurationMs() {
      const endMs = stoppedAtMs ?? now()
      return initialDurationMs + Math.max(0, endMs - startedAtMs)
    },
  }
}
