import type { ModelConfig } from "@/lib/models/types"

/** Product funding policy for an ordinary platform-funded answer. */
export const PLATFORM_RESPONSE_OUTPUT_TOKENS = 8_192

/** Contextual manual retry offered after OpenRouter rejects an Auto request. */
export const AFFORDABILITY_RETRY_GENERATION_BUDGET = 16_384

/** Wire guard only. Route metadata remains the model-specific authority. */
export const MAX_GENERATION_BUDGET = 2_000_000

const DEFAULT_THINKING_BUDGET_TOKENS = 10_000
const SEARCH_DOWNGRADE_BUDGET_TOKENS = 10_000

export type GenerationBudgetRouteFacts = Pick<
  ModelConfig,
  | "providerId"
  | "reasoningText"
  | "thinkingMode"
  | "thinkingBudget"
  | "searchThinkingDowngrade"
  | "maxOutput"
>

export type GenerationBudgetResolution =
  | {
      ok: true
      /** User-selected total generation allowance, before route clamping. */
      requestedGenerationBudget?: number
      /** Total provider output allowance, including fixed reasoning tokens. */
      appliedGenerationBudget?: number
      /** AI SDK value; fixed Anthropic reasoning is added by its adapter. */
      providerMaxOutputTokens?: number
      /** Worst-case output tokens used for platform credit reservation. */
      platformOutputTokenReservation?: number
    }
  | {
      ok: false
      minimumGenerationBudget: number
    }

export function isGenerationBudget(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_GENERATION_BUDGET
  )
}

/** Fixed reasoning the Anthropic SDK adds to generic maxOutputTokens. */
export function fixedThinkingBudgetTokens(
  modelConfig: GenerationBudgetRouteFacts,
  searchToolsActive: boolean
): number {
  if (
    modelConfig.providerId !== "anthropic" ||
    modelConfig.reasoningText !== true
  ) {
    return 0
  }
  if (
    modelConfig.thinkingMode === "adaptive" &&
    !(modelConfig.searchThinkingDowngrade === true && searchToolsActive)
  ) {
    return 0
  }
  return modelConfig.thinkingMode === "adaptive"
    ? SEARCH_DOWNGRADE_BUDGET_TOKENS
    : (modelConfig.thinkingBudget ?? DEFAULT_THINKING_BUDGET_TOKENS)
}

/**
 * Resolve product policy into provider and funding facts.
 *
 * Auto BYOK deliberately omits the provider parameter. Credential ownership
 * does not create a response-length policy. Platform funding adds its own
 * ceiling, while an explicit user budget applies to either credential source.
 */
export function resolveGenerationBudget(args: {
  route: GenerationBudgetRouteFacts
  credentialSource: "platform" | "byok"
  requestedGenerationBudget?: number
  searchToolsActive: boolean
}): GenerationBudgetResolution {
  const fixedThinkingTokens = fixedThinkingBudgetTokens(
    args.route,
    args.searchToolsActive
  )
  const platformCeiling =
    args.credentialSource === "platform"
      ? PLATFORM_RESPONSE_OUTPUT_TOKENS + fixedThinkingTokens
      : undefined
  const requested = args.requestedGenerationBudget

  let totalBudget = requested
  if (platformCeiling !== undefined) {
    totalBudget =
      totalBudget === undefined
        ? platformCeiling
        : Math.min(totalBudget, platformCeiling)
  }
  if (totalBudget === undefined) return { ok: true }

  if (args.route.maxOutput !== undefined) {
    totalBudget = Math.min(totalBudget, args.route.maxOutput)
  }
  if (totalBudget <= fixedThinkingTokens) {
    return {
      ok: false,
      minimumGenerationBudget: fixedThinkingTokens + 1,
    }
  }

  return {
    ok: true,
    ...(requested !== undefined
      ? { requestedGenerationBudget: requested }
      : {}),
    appliedGenerationBudget: totalBudget,
    providerMaxOutputTokens: totalBudget - fixedThinkingTokens,
    ...(args.credentialSource === "platform"
      ? { platformOutputTokenReservation: totalBudget }
      : {}),
  }
}
