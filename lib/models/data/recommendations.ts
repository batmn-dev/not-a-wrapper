import type { ModelRecommendationPolicy } from "../types"

/**
 * Exact default portfolios explicitly chosen by product. Models omitted from
 * a maker's policy remain selectable as Legacy models.
 */
export const MODEL_RECOMMENDATION_POLICIES = [
  {
    vendorId: "claude",
    currentModelIds: [
      "claude-fable-5",
      "openrouter:anthropic/claude-opus-5",
      "claude-sonnet-5",
      "claude-haiku-4-5-20251001",
    ],
    verifiedAt: "2026-08-25",
  },
  {
    vendorId: "gemini",
    currentModelIds: [
      "openrouter:google/gemini-3.5-flash-lite",
      "openrouter:google/gemini-3.7-flash",
      "gemini-3.1-pro-preview",
    ],
    verifiedAt: "2026-08-25",
  },
  {
    vendorId: "openai",
    currentModelIds: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"],
    verifiedAt: "2026-08-25",
  },
] as const satisfies readonly ModelRecommendationPolicy[]
