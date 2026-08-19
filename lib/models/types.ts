import type { Provider } from "@/lib/provider-identity"
import type { ToolCapabilities } from "@/lib/tools/types"

export type ModelCatalogStatus = "visible" | "hidden" | "legacy"

export type ModelIdKind = "stable" | "snapshot" | "alias" | "wrapped"

export type ModelReasoningEffort =
  "minimal" | "low" | "medium" | "high" | "xhigh"

/**
 * Construction-time reasoning declaration for models whose provider takes
 * reasoning as a model-construction setting rather than a per-call provider
 * option (today: OpenRouter's `.chat(id, { reasoning })`; per-call reasoning
 * lives in Request shaping — lib/openproviders/request-shaping.ts). Exactly
 * one knob: an effort level or a reasoning-token budget.
 */
export type ModelReasoningSettings =
  | { effort: ModelReasoningEffort; maxTokens?: never }
  | { maxTokens: number; effort?: never }

type ModelConfig = {
  id: string
  name: string
  provider: string
  providerId: Provider
  modelFamily?: string
  baseProviderId: string

  description?: string
  tags?: string[]

  catalogStatus: ModelCatalogStatus
  idKind: Exclude<ModelIdKind, "alias">
  replacementModelId?: string
  verifiedAgainst?: string
  lastVerifiedAt?: string

  contextWindow?: number
  maxOutput?: number
  inputCost?: number
  outputCost?: number
  priceUnit?: string

  vision?: boolean
  tools?: boolean | ToolCapabilities
  audio?: boolean
  reasoningText?: boolean
  webSearch?: boolean
  openSource?: boolean

  /**
   * Thinking mode for this model.
   *   - "adaptive" — model dynamically allocates thinking budget (Opus 4.6+)
   *   - "enabled"  — fixed budget via budgetTokens (default for older models)
   *   - undefined  — inherit from reasoningText flag (backward compat)
   */
  thinkingMode?: "adaptive" | "enabled"

  /**
   * Fixed thinking budget in tokens, used when thinkingMode is "enabled"
   * (or unset). Models without a declared budget fall back to the
   * Request shaping default (10000).
   */
  thinkingBudget?: number

  /**
   * Anthropic-only: when server-side search tools are active, Request shaping
   * downgrades adaptive thinking to {type: "enabled", budgetTokens} (the
   * pause_turn workaround). Set ONLY on 4.6-generation models — `budget_tokens`
   * is removed upstream on Opus 4.7+/Sonnet 5/Fable 5 (HTTP 400; Fable 5
   * accepts only adaptive or omitted thinking).
   */
  searchThinkingDowngrade?: boolean

  /**
   * Construction-time reasoning settings, fed to the Provider strategy's
   * `languageModel(id, settings)` when the model is built. Only providers
   * whose reasoning knob is construction-time consume it (today: OpenRouter);
   * every other strategy ignores it. Distinct from `reasoningText`, which
   * remains the capability FLAG (the model emits reasoning text) — this field
   * is the request CONFIGURATION that turns reasoning output on.
   */
  reasoning?: ModelReasoningSettings

  speed?: "Fast" | "Medium" | "Slow"
  intelligence?: "Low" | "Medium" | "High"

  website?: string
  apiDocs?: string
  modelPage?: string
  releasedAt?: string

  icon?: string

  accessible?: boolean
}

export type { ModelConfig }
