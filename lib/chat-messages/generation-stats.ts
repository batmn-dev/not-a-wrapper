/**
 * Generation stats — the user-facing record of how an assistant message's
 * generation performed (CONTEXT.md, ADR-0030). Stored in the message
 * metadata blob at finish; provider figures come from the AI SDK's per-step
 * performance, the same clock the run's timing receipt reads. Accumulates
 * across an approval continuation (like work duration). Tokens per second is
 * derived here at presentation and never stored; absent provider usage stays
 * absent rather than estimated.
 */

export type GenerationStats = {
  /** Provider dispatch → first output chunk; first run and first step only. */
  timeToFirstTokenMs?: number
  /**
   * Σ over output-producing steps of (response time − time to first output):
   * the window in which the provider streamed output. Excludes every step's
   * own time-to-first-output and client-side tool execution. Provider-run
   * (hosted) tools execute inside the provider response, so their time stays
   * inside this window — see `providerToolCalls`.
   */
  outputStreamMs?: number
  /** Provider-reported generated tokens, hidden reasoning included. */
  outputTokens?: number
  /** The reasoning share of `outputTokens`, when the provider reports it. */
  reasoningTokens?: number
  inputTokens?: number
  /** Cache-read share of `inputTokens`, when the provider reports it. */
  cachedInputTokens?: number
  /** Steps that produced output. */
  stepCount?: number
  /** Tool calls the provider executed itself (e.g. hosted web search). */
  providerToolCalls?: number
}

export const GENERATION_STATS_KEYS = [
  "timeToFirstTokenMs",
  "outputStreamMs",
  "outputTokens",
  "reasoningTokens",
  "inputTokens",
  "cachedInputTokens",
  "stepCount",
  "providerToolCalls",
] as const satisfies ReadonlyArray<keyof GenerationStats>

const INTEGER_KEYS = new Set<keyof GenerationStats>([
  "outputTokens",
  "reasoningTokens",
  "inputTokens",
  "cachedInputTokens",
  "stepCount",
  "providerToolCalls",
])

function isValidStatValue(key: keyof GenerationStats, value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return false
  }
  return INTEGER_KEYS.has(key) ? Number.isSafeInteger(value) : true
}

/**
 * Narrow an unknown blob to the known keys with valid values; unknown keys
 * and malformed values are dropped. Returns undefined when nothing survives,
 * so an empty object is never persisted or rendered.
 */
export function parseGenerationStats(
  value: unknown
): GenerationStats | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }
  const record = value as Record<string, unknown>
  const stats: GenerationStats = {}
  for (const key of GENERATION_STATS_KEYS) {
    const raw = record[key]
    if (isValidStatValue(key, raw)) stats[key] = raw as number
  }
  return Object.keys(stats).length > 0 ? stats : undefined
}

/**
 * Presentation-ready view. Three states, switched exhaustively by the row:
 * nothing to show; time to first token alone (the provider omitted usage);
 * or the complete line.
 *
 * `tokensPerSecond` is the VISIBLE output rate: (output − reasoning) tokens
 * over the output window. Providers that hide reasoning (OpenAI) generate
 * those tokens before the first output chunk — inside time to first token,
 * outside the window — so counting them would inflate the rate by exactly
 * the hidden share. Providers that stream thinking inside the window read
 * conservatively instead; never inflated. Undefined when the window is zero
 * (a single-chunk response) or nothing visible was generated, so a rate can
 * never be fabricated.
 */
export type GenerationStatsView =
  | { kind: "none" }
  | { kind: "tokens-unavailable"; timeToFirstTokenMs: number }
  | {
      kind: "complete"
      timeToFirstTokenMs: number | undefined
      outputTokens: number
      /** `outputTokens` minus the reported reasoning share. */
      visibleOutputTokens: number
      tokensPerSecond: number | undefined
      outputStreamMs: number | undefined
      reasoningTokens: number | undefined
      inputTokens: number | undefined
      cachedInputTokens: number | undefined
      stepCount: number | undefined
      providerToolCalls: number | undefined
    }

export function deriveGenerationStatsView(
  stats: GenerationStats | undefined
): GenerationStatsView {
  if (!stats) return { kind: "none" }
  const { timeToFirstTokenMs, outputTokens, outputStreamMs } = stats
  if (outputTokens === undefined) {
    return timeToFirstTokenMs === undefined
      ? { kind: "none" }
      : { kind: "tokens-unavailable", timeToFirstTokenMs }
  }
  const visibleOutputTokens = Math.max(
    0,
    outputTokens - (stats.reasoningTokens ?? 0)
  )
  const tokensPerSecond =
    outputStreamMs !== undefined &&
    outputStreamMs > 0 &&
    visibleOutputTokens > 0
      ? (visibleOutputTokens * 1000) / outputStreamMs
      : undefined
  return {
    kind: "complete",
    timeToFirstTokenMs,
    outputTokens,
    visibleOutputTokens,
    tokensPerSecond,
    outputStreamMs,
    reasoningTokens: stats.reasoningTokens,
    inputTokens: stats.inputTokens,
    cachedInputTokens: stats.cachedInputTokens,
    stepCount: stats.stepCount,
    providerToolCalls: stats.providerToolCalls,
  }
}

const tokenFormatter = new Intl.NumberFormat("en-US")

export function formatTokenCount(tokens: number): string {
  return tokenFormatter.format(tokens)
}

/** One decimal: `34.6`. */
export function formatTokensPerSecond(rate: number): string {
  return rate.toFixed(1)
}

/** Whole milliseconds as seconds with two decimals: 420 → `0.42`. */
export function formatMsAsSeconds(ms: number): string {
  return (ms / 1000).toFixed(2)
}
