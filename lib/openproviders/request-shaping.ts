import type { ProviderOptions } from "@ai-sdk/provider-utils"
import type { ModelConfig } from "@/lib/models/types"
import { ANTHROPIC_BETA_HEADERS } from "@/lib/config"

/**
 * Request shaping (CONTEXT.md): everything provider-specific about issuing
 * one model request, resolved from the model config plus request context —
 * provider options (thinking/reasoning configuration, per-model thinking
 * budgets) and provider beta headers. Callers spread the result into
 * streamText and never branch on provider.
 */

export type RequestShapingContext = {
  /** Server-side search tools are active for this request. */
  searchToolsActive: boolean
  /** The request carries any tools at all (any Tool layer). */
  hasTools: boolean
}

export type ShapedRequest = {
  providerOptions: ProviderOptions
  headers: Record<string, string>
}

/** Thinking budget for models that don't declare `thinkingBudget`. */
const DEFAULT_THINKING_BUDGET_TOKENS = 10000

/**
 * Budget for the pause_turn search downgrade (see resolveProviderOptions).
 * Server-side web search results (encrypted_content) are counted as INPUT
 * tokens, so they don't consume from max_tokens — no reduction needed.
 * (Source: Anthropic web search tool docs)
 */
const SEARCH_DOWNGRADE_BUDGET_TOKENS = 10000

export function shapeRequest(
  modelConfig: ModelConfig,
  ctx: RequestShapingContext
): ShapedRequest {
  return {
    providerOptions: resolveProviderOptions(modelConfig, ctx),
    headers: resolveHeaders(modelConfig, ctx),
  }
}

/**
 * Provider-specific options to enable reasoning/thinking when the model
 * advertises support (reasoningText: true).
 *
 * Anthropic thinking configuration is context-aware:
 *   - Models with thinkingMode: "adaptive" (Opus 4.6+) use Anthropic's
 *     adaptive allocation — the recommended mode per Anthropic's docs.
 *     "enabled" with budget_tokens is deprecated on Opus 4.6.
 *   - Other models use "enabled" with the model's declared thinkingBudget
 *     (falling back to DEFAULT_THINKING_BUDGET_TOKENS).
 *
 * SDK LIMITATION (ai@6.0.78 / @ai-sdk/anthropic@3.0.41):
 * When adaptive thinking is used with server-side tools (web search), the
 * Anthropic API may return stop_reason: "pause_turn" — indicating the model
 * needs a follow-up request to continue generating text. The AI SDK maps
 * "pause_turn" to the same unified finishReason as "end_turn" ("stop") and
 * the step continuation logic does not re-send the conversation. This
 * results in responses with reasoning + tool results but zero text content.
 *
 * WORKAROUND: When search tools are active, fall back to "enabled" thinking
 * with a conservative budget. This produces a complete response in a single
 * API call (no pause_turn). For non-search requests, adaptive thinking works
 * correctly and is preferred. Delete this downgrade once the SDK handles
 * pause_turn continuation.
 */
function resolveProviderOptions(
  modelConfig: ModelConfig,
  ctx: RequestShapingContext
): ProviderOptions {
  if (!modelConfig.reasoningText) return {}

  switch (modelConfig.providerId) {
    case "anthropic": {
      if (modelConfig.thinkingMode === "adaptive" && !ctx.searchToolsActive) {
        return { anthropic: { thinking: { type: "adaptive" } } }
      }
      const budgetTokens =
        modelConfig.thinkingMode === "adaptive"
          ? SEARCH_DOWNGRADE_BUDGET_TOKENS
          : (modelConfig.thinkingBudget ?? DEFAULT_THINKING_BUDGET_TOKENS)
      return { anthropic: { thinking: { type: "enabled", budgetTokens } } }
    }
    case "google":
      return { google: { thinkingConfig: { includeThoughts: true } } }
    case "openai":
      return { openai: { reasoningEffort: "medium", reasoningSummary: "auto" } }
    // xai: deliberately no options. Grok 4-family reasoning models reason
    // unconditionally — xAI's reasoning_effort knob applies only to
    // grok-3-mini-class models, so any value sent for the cataloged Groks
    // is rejected (the pre-fix "invalid xai provider options" 503).
    default:
      return {}
  }
}

/**
 * Anthropic Token-Efficient Tool Use: when an Anthropic model has tools
 * injected, the token-efficient beta header reduces tool definition token
 * consumption. Request-scoped via streamText({ headers }) — only affects
 * Anthropic requests that actually include tools. Safe to apply:
 * @ai-sdk/anthropic@3.0.41 comma-merges user and inferred betas
 * (getBetasFromHeaders + Array.from(betas).join(",")).
 *
 * Disable with ANTHROPIC_TOKEN_EFFICIENT_TOOLS=false.
 */
function resolveHeaders(
  modelConfig: ModelConfig,
  ctx: RequestShapingContext
): Record<string, string> {
  const headers: Record<string, string> = {}
  const isTokenEfficient =
    process.env.ANTHROPIC_TOKEN_EFFICIENT_TOOLS !== "false"

  if (modelConfig.providerId === "anthropic" && ctx.hasTools && isTokenEfficient) {
    headers["anthropic-beta"] = ANTHROPIC_BETA_HEADERS.tokenEfficient
  }
  return headers
}
