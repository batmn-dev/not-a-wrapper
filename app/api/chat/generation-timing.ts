import type { RunTimingReceipt } from "@/convex/lib/runTimingReceipt"
import type { GenerationStats } from "@/lib/chat-messages/generation-stats"

/**
 * The one provider-timing source for a chat turn (ADR-0030): the AI SDK's
 * per-step `performance` and `usage`, read in `onStepEnd`. The SDK samples
 * them on a monotonic clock inside the step stream, upstream of every
 * `experimental_transform`, so smoothing and approval transforms cannot skew
 * them. Both records below derive from the same recorded steps:
 *  - Generation stats (message-level, continuation-accumulated, user-facing);
 *  - the provider segments of the Run timing receipt (this run only).
 * No chunk-callback clocks are kept anywhere else.
 */

/** The structural slice of an AI SDK `StepResult` the tracker reads. */
export type StepTimingFacts = {
  readonly performance: {
    readonly timeToFirstOutputMs: number | undefined
    readonly responseTimeMs: number
    readonly toolExecutionMs: Readonly<Record<string, number>>
  }
  readonly usage: {
    readonly inputTokens: number | undefined
    readonly outputTokens: number | undefined
    readonly inputTokenDetails: { readonly cacheReadTokens: number | undefined }
    readonly outputTokenDetails: {
      readonly reasoningTokens: number | undefined
    }
  }
  /**
   * Provider-executed (hosted) tool calls run inside the provider response:
   * the SDK's `toolExecutionMs` covers client tools only, so their time is
   * inside the output window. Counted so the stats can say so.
   */
  readonly toolCalls: ReadonlyArray<{ readonly providerExecuted?: boolean }>
}

export type ProviderReceiptSegments = Pick<
  RunTimingReceipt,
  "providerFirstOutputMs" | "modelResponseMs" | "toolExecutionMs"
>

export type GenerationTimingTracker = {
  recordStep(step: StepTimingFacts): void
  /** Message-level stats; undefined until a step or a continuation seed exists. */
  stats(): GenerationStats | undefined
  /** This run's provider-owned receipt segments; empty until a step lands. */
  providerSegments(): ProviderReceiptSegments
  /**
   * This run's first step's time to first output — the offset from provider
   * dispatch at which the first output chunk existed. Undefined until the
   * first step finishes.
   */
  firstOutputOffsetMs(): number | undefined
}

const round2 = (value: number) => Math.round(value * 100) / 100

function isCount(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0
}

/** Sums that stay undefined until observed; `complete` flips false when any step omits the count. */
type CountSum = { total: number; observed: boolean; complete: boolean }

function addCount(sum: CountSum, value: number | undefined): void {
  if (isCount(value)) {
    sum.total += value
    sum.observed = true
  } else {
    sum.complete = false
  }
}

export function createGenerationTimingTracker(options?: {
  /** The reused assistant message's persisted stats on an approval continuation. */
  initialStats?: GenerationStats
}): GenerationTimingTracker {
  const seed = options?.initialStats
  let runFirstOutputMs: number | undefined
  let runModelResponseMs = 0
  let runToolExecutionMs = 0
  let recordedSteps = 0
  let outputSteps = 0
  let outputStreamMs = 0
  let providerToolCalls = 0
  // Required counts: absent for the whole message if any step omitted them.
  const output: CountSum = { total: 0, observed: false, complete: true }
  const input: CountSum = { total: 0, observed: false, complete: true }
  // Detail counts: a step that reports none contributes nothing.
  let reasoningTokens: number | undefined
  let cachedInputTokens: number | undefined

  return {
    recordStep(step) {
      recordedSteps += 1
      const { timeToFirstOutputMs, responseTimeMs, toolExecutionMs } =
        step.performance
      runModelResponseMs += Math.max(0, responseTimeMs)
      for (const duration of Object.values(toolExecutionMs)) {
        runToolExecutionMs += Math.max(0, duration)
      }
      if (timeToFirstOutputMs !== undefined) {
        if (runFirstOutputMs === undefined)
          runFirstOutputMs = timeToFirstOutputMs
        outputSteps += 1
        outputStreamMs += Math.max(0, responseTimeMs - timeToFirstOutputMs)
      }
      for (const call of step.toolCalls) {
        if (call.providerExecuted) providerToolCalls += 1
      }
      addCount(output, step.usage.outputTokens)
      addCount(input, step.usage.inputTokens)
      const reasoning = step.usage.outputTokenDetails.reasoningTokens
      if (isCount(reasoning))
        reasoningTokens = (reasoningTokens ?? 0) + reasoning
      const cached = step.usage.inputTokenDetails.cacheReadTokens
      if (isCount(cached)) cachedInputTokens = (cachedInputTokens ?? 0) + cached
    },

    stats() {
      if (recordedSteps === 0) return seed
      const timeToFirstTokenMs = seed?.timeToFirstTokenMs ?? runFirstOutputMs
      const stats: GenerationStats = {}
      if (timeToFirstTokenMs !== undefined) {
        stats.timeToFirstTokenMs = round2(timeToFirstTokenMs)
      }
      if (outputSteps > 0 || seed?.outputStreamMs !== undefined) {
        stats.outputStreamMs = round2(
          (seed?.outputStreamMs ?? 0) + outputStreamMs
        )
      }
      if (output.observed && output.complete) {
        stats.outputTokens = (seed?.outputTokens ?? 0) + output.total
      }
      if (input.observed && input.complete) {
        stats.inputTokens = (seed?.inputTokens ?? 0) + input.total
      }
      if (
        reasoningTokens !== undefined ||
        seed?.reasoningTokens !== undefined
      ) {
        stats.reasoningTokens =
          (seed?.reasoningTokens ?? 0) + (reasoningTokens ?? 0)
      }
      if (
        cachedInputTokens !== undefined ||
        seed?.cachedInputTokens !== undefined
      ) {
        stats.cachedInputTokens =
          (seed?.cachedInputTokens ?? 0) + (cachedInputTokens ?? 0)
      }
      const stepCount = (seed?.stepCount ?? 0) + outputSteps
      if (stepCount > 0) stats.stepCount = stepCount
      const hostedCalls = (seed?.providerToolCalls ?? 0) + providerToolCalls
      if (hostedCalls > 0) stats.providerToolCalls = hostedCalls
      return stats
    },

    providerSegments() {
      if (recordedSteps === 0) return {}
      return {
        ...(runFirstOutputMs !== undefined
          ? { providerFirstOutputMs: round2(runFirstOutputMs) }
          : {}),
        modelResponseMs: round2(runModelResponseMs),
        toolExecutionMs: round2(runToolExecutionMs),
      }
    },

    firstOutputOffsetMs() {
      return runFirstOutputMs
    },
  }
}
