import { ANTHROPIC_BETA_HEADERS } from "@/lib/config"
import type { ModelConfig } from "@/lib/models/types"
import type { ProviderOptions } from "@ai-sdk/provider-utils"

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
 * Enable reasoning according to the selected model's catalog metadata.
 *
 * AI SDK 7 currently maps Anthropic `pause_turn` to `stop` without continuing
 * the request. Catalogued models with `searchThinkingDowngrade` therefore use
 * fixed-budget thinking while search is active to avoid a reasoning-only
 * response. Never apply that workaround to later models that reject fixed
 * budgets; fix renewed `pause_turn` failures at the SDK continuation layer.
 */
function resolveProviderOptions(
  modelConfig: ModelConfig,
  ctx: RequestShapingContext
): ProviderOptions {
  if (!modelConfig.reasoningText) return {}

  switch (modelConfig.providerId) {
    case "anthropic": {
      const downgradeForSearch =
        modelConfig.searchThinkingDowngrade === true && ctx.searchToolsActive
      if (modelConfig.thinkingMode === "adaptive" && !downgradeForSearch) {
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
    // Catalogued Grok 4 models reason unconditionally and reject the
    // grok-3-mini reasoning-effort option.
    //
    // OpenRouter reasoning remains construction-time provider state in its V4
    // provider API; the catalog setting is mapped in provider-strategy.ts.
    default:
      return {}
  }
}

/** Add Anthropic's token-efficient-tools beta only to requests with tools. */
function resolveHeaders(
  modelConfig: ModelConfig,
  ctx: RequestShapingContext
): Record<string, string> {
  const headers: Record<string, string> = {}
  const isTokenEfficient =
    process.env.ANTHROPIC_TOKEN_EFFICIENT_TOOLS !== "false"

  if (
    modelConfig.providerId === "anthropic" &&
    ctx.hasTools &&
    isTokenEfficient
  ) {
    headers["anthropic-beta"] = ANTHROPIC_BETA_HEADERS.tokenEfficient
  }
  return headers
}
