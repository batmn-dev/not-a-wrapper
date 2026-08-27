import { ANTHROPIC_BETA_HEADERS } from "@/lib/config"
import type { ModelConfig, ModelReasoningEffort } from "@/lib/models/types"
import { REASONING_EFFORT_LEVELS } from "@/lib/models/types"
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
  /**
   * The APPLIED per-turn effort (ADR-0026) — already resolved through
   * {@link resolveAppliedReasoningEffort}, so it is guaranteed to be a level
   * this route's provider accepts. Absent = Default (today's shapes exactly).
   */
  reasoningEffort?: ModelReasoningEffort
}

/**
 * Resolve the user's requested effort into what this route actually runs
 * (ADR-0026). Absent request, an effortless route, or a platform-funded turn
 * (the ADR-0021 reservation estimate assumes default thinking) all resolve
 * to Default; a level the route doesn't offer clamps to the nearest one in
 * canonical order (ties prefer the cheaper side).
 */
export function resolveAppliedReasoningEffort(
  modelConfig: Pick<ModelConfig, "effortLevels">,
  requested: ModelReasoningEffort | undefined,
  ctx: { platformFunded: boolean }
): ModelReasoningEffort | undefined {
  if (requested === undefined || ctx.platformFunded) return undefined
  const levels = modelConfig.effortLevels
  if (!levels || levels.length === 0) return undefined
  if (levels.includes(requested)) return requested

  const requestedIndex = REASONING_EFFORT_LEVELS.indexOf(requested)
  let nearest: ModelReasoningEffort | undefined
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const level of levels) {
    const distance = Math.abs(
      REASONING_EFFORT_LEVELS.indexOf(level) - requestedIndex
    )
    if (
      distance < nearestDistance ||
      (distance === nearestDistance &&
        nearest !== undefined &&
        REASONING_EFFORT_LEVELS.indexOf(level) <
          REASONING_EFFORT_LEVELS.indexOf(nearest))
    ) {
      nearest = level
      nearestDistance = distance
    }
  }
  return nearest
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
  const effort = ctx.reasoningEffort

  switch (modelConfig.providerId) {
    case "anthropic": {
      const downgradeForSearch =
        modelConfig.searchThinkingDowngrade === true && ctx.searchToolsActive
      if (modelConfig.thinkingMode === "adaptive" && !downgradeForSearch) {
        // Effort rides only the adaptive path, and the catalog never offers
        // "none" on Anthropic — so the Opus 5 "disabled thinking + xhigh/max
        // → 400" combination is unrepresentable here by construction.
        return {
          anthropic: {
            thinking: { type: "adaptive" },
            ...(effort !== undefined ? { effort } : {}),
          },
        }
      }
      // Fixed-budget path (pause_turn downgrade or budget-era models):
      // `effort` and `budget_tokens` don't combine — the budget wins and the
      // turn runs at Default. The receipt reflects what actually applied.
      const budgetTokens =
        modelConfig.thinkingMode === "adaptive"
          ? SEARCH_DOWNGRADE_BUDGET_TOKENS
          : (modelConfig.thinkingBudget ?? DEFAULT_THINKING_BUDGET_TOKENS)
      return { anthropic: { thinking: { type: "enabled", budgetTokens } } }
    }
    case "google":
      return {
        google: {
          thinkingConfig: {
            includeThoughts: true,
            // Gemini 3.x takes thinkingLevel; 2.5 models never declare
            // effortLevels, so effort stays undefined for them here.
            ...(effort !== undefined ? { thinkingLevel: effort } : {}),
          },
        },
      }
    case "openai":
      return {
        openai: {
          reasoningEffort: effort ?? "medium",
          reasoningSummary: "auto",
        },
      }
    case "xai":
      // Only grok-4.3 declares effortLevels (the other catalogued Grok 4
      // models reason unconditionally and reject the parameter), so effort
      // is undefined for them and the option is never sent.
      return effort !== undefined ? { xai: { reasoningEffort: effort } } : {}
    // OpenRouter reasoning remains construction-time provider state in its V4
    // provider API; the catalog setting (and the per-turn effort override)
    // is mapped in provider-strategy.ts at model construction.
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
