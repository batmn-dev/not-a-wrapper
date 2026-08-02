/**
 * formatDuration — `Ns` under a minute, else `Mm Ss`. A neutral, cross-module
 * formatter: the Activity panel header + trigger and the Reasoning primitive all
 * consume it, so it lives in `lib` rather than inside a UI primitive.
 * `components/ui/reasoning` re-exports it for back-compat.
 */
export function formatDuration(seconds: number): string {
  if (seconds === 0) return "<1s"
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}m ${secs}s`
}

/**
 * Convert a completed millisecond duration into displayable whole seconds.
 * Sub-second activity is represented by 0 and formatted honestly as `<1s`;
 * floor semantics avoid rounding 1000-1999ms up to two seconds.
 */
export function toCompletedDurationSeconds(
  durationMs: number | undefined
): number | undefined {
  if (
    durationMs === undefined ||
    !Number.isFinite(durationMs) ||
    durationMs < 0
  ) {
    return undefined
  }

  return durationMs < 1000 ? 0 : Math.floor(durationMs / 1000)
}
