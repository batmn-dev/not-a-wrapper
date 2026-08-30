import { PostHog } from "posthog-node"

let posthogClient: PostHog | null = null

/**
 * Get the PostHog client singleton for LLM analytics.
 * Returns null if POSTHOG_API_KEY is not configured.
 *
 * Configured for serverless environments (Vercel/Next.js):
 * - flushAt: 1 - Send events immediately (no batching)
 * - flushInterval: 0 - Don't wait for batch timer
 *
 * IMPORTANT: In serverless, you MUST call `await flushPostHog()`
 * before the function returns to ensure events are flushed.
 * Use Next.js `after()` for streaming responses.
 *
 * @see https://posthog.com/docs/llm-analytics/installation/vercel-ai
 * @see https://posthog.com/docs/libraries/vercel
 */
export function getPostHogClient(): PostHog | null {
  if (!process.env.POSTHOG_API_KEY) {
    if (process.env.NODE_ENV === "development") {
      console.debug(
        "[PostHog] POSTHOG_API_KEY not configured, skipping LLM analytics"
      )
    }
    return null
  }

  if (!posthogClient) {
    posthogClient = new PostHog(process.env.POSTHOG_API_KEY, {
      host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
      // Serverless-optimized settings: send events immediately
      flushAt: 1,
      flushInterval: 0,
    })

    if (process.env.NODE_ENV === "development") {
      console.debug("[PostHog] Client initialized for LLM analytics")
    }
  }

  return posthogClient
}

/**
 * Flush pending PostHog events without destroying the client.
 * Call this in `after()` callbacks for streaming responses.
 *
 * Flushing keeps the client reusable in warm serverless containers.
 */
export async function flushPostHog(): Promise<void> {
  if (posthogClient) {
    try {
      await posthogClient.flush()
    } catch (error) {
      console.error("[PostHog] Error during flush:", error)
    }
  }
}

/**
 * Capture an LLM generation event manually.
 * Use this with streamText's onFinish callback for accurate output capture.
 *
 * @see https://posthog.com/docs/llm-analytics/installation/manual-capture
 */
export function captureGeneration({
  distinctId,
  traceId,
  model,
  provider,
  input,
  output,
  inputTokens,
  outputTokens,
  latencyMs,
  isError,
  errorMessage,
  properties,
}: {
  distinctId: string
  traceId: string
  model: string
  provider: string
  input: unknown
  output: string | null
  inputTokens?: number
  outputTokens?: number
  latencyMs?: number
  isError?: boolean
  errorMessage?: string
  properties?: Record<string, unknown>
}): void {
  if (!posthogClient) return

  const totalTokens =
    inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined

  posthogClient.capture({
    distinctId,
    event: "$ai_generation",
    properties: {
      $ai_trace_id: traceId,
      $ai_model: model,
      $ai_provider: provider,
      $ai_input: input,
      $ai_input_tokens: inputTokens,
      $ai_output_choices: output
        ? [{ role: "assistant", content: output }]
        : [],
      $ai_output_tokens: outputTokens,
      $ai_total_tokens: totalTokens,
      $ai_latency: latencyMs !== undefined ? latencyMs / 1000 : undefined,
      $ai_is_error: isError ?? false,
      $ai_error: errorMessage,
      ...properties,
    },
  })
}
