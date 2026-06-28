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
