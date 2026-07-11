/**
 * formatDuration — `Ns` under a minute, else `Mm Ss`. A neutral, cross-module
 * formatter: the Activity panel header + trigger and the Reasoning primitive all
 * consume it, so it lives in `lib` rather than inside a UI primitive.
 * `components/ui/reasoning` re-exports it for back-compat.
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}m ${secs}s`
}

export const COMPLETED_DURATION_THRESHOLD_MS = 1000

/**
 * Convert a completed millisecond duration into displayable whole seconds.
 * A full second must have elapsed before the UI makes a duration claim, and
 * floor semantics avoid rounding 1000-1999ms up to two seconds.
 */
export function toCompletedDurationSeconds(
  durationMs: number | undefined
): number | undefined {
  if (
    durationMs === undefined ||
    !Number.isFinite(durationMs) ||
    durationMs < COMPLETED_DURATION_THRESHOLD_MS
  ) {
    return undefined
  }

  return Math.floor(durationMs / 1000)
}
