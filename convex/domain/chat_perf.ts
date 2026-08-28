/**
 * Content-free, sampled perf logging for Convex functions (measurement plan
 * Phase 2 §2.3). Deliberately correlation-free: the x-chat-perf-id never
 * crosses the worker wire, so these lines join Next-side `chat_perf` events
 * statistically, not per-request. Every numeric field is a power-of-two
 * bucket or a small count; string fields are closed enums chosen at the call
 * site. Never log ids, content, or exact content-derived sizes.
 *
 * Off by default: set CHAT_PERF_CONVEX_SAMPLE_RATE (0..1) on the deployment.
 */

export function chatPerfConvexSampleRate(): number {
  const raw = process.env.CHAT_PERF_CONVEX_SAMPLE_RATE
  if (!raw) return 0
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return 0
  return Math.min(1, Math.max(0, parsed))
}

/**
 * Per-invocation sampling decision. Convex's runtime provides seeded
 * randomness in queries, so this is safe in deterministic function bodies;
 * cached query results never re-execute, which is exactly right — a sampled
 * log line marks a real execution, so line counts measure re-execution.
 */
export function shouldSampleChatPerfConvex(): boolean {
  const rate = chatPerfConvexSampleRate()
  if (rate <= 0) return false
  return Math.random() < rate
}

/** Coarse power-of-two bucket (1, 2, 4, … capped at 2^30); size class only. */
export function bucketPow2(value: number): number {
  if (!Number.isFinite(value) || value <= 1) return 1
  const capped = Math.min(value, 1 << 30)
  return 2 ** Math.ceil(Math.log2(capped))
}

export function logChatPerfConvex(
  event: string,
  fields: Record<string, number | string>
): void {
  try {
    console.log(
      JSON.stringify({ _tag: "chat_perf_convex", event, ...fields })
    )
  } catch {
    // Best-effort diagnostics only.
  }
}
