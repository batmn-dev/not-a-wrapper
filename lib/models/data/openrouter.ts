import { ModelConfig } from "../types"

// Catalog refresh 2026-07-04: OpenRouter delisted both previous free entries
// (`deepseek/deepseek-r1:free`, `meta-llama/llama-3.3-8b-instruct:free`) — the
// live API returns "No endpoints found" for them. Successions live in
// `lib/models/model-id-migration.ts`. Metadata below mirrors the OpenRouter
// `/api/v1/models` listing (context length, pricing, supported_parameters).
export const openrouterModels: ModelConfig[] = [
  {
    id: "openrouter:openai/gpt-oss-120b:free",
    name: "GPT-OSS 120B",
    provider: "OpenRouter",
    providerId: "openrouter",
    catalogStatus: "visible",
    idKind: "wrapped",
    verifiedAgainst: "openai/gpt-oss-120b:free",
    lastVerifiedAt: "2026-07-04",
    modelFamily: "GPT-OSS",
    baseProviderId: "openai",
    description:
      "OpenAI's open-weight 120B MoE reasoning model (Apache 2.0), served on OpenRouter's free tier.",
    tags: ["reasoning", "OSS", "free"],
    contextWindow: 131072,
    inputCost: 0,
    outputCost: 0,
    priceUnit: "per 1M tokens",
    vision: false,
    tools: true,
    audio: false,
    reasoningText: true,
    // Construction-time reasoning config (Provider strategy seam): OpenRouter's
    // knob is a `.chat(id, { reasoning })` setting; gpt-oss takes effort
    // levels natively and "medium" is its default depth. Live-verified
    // 2026-07-04: OpenRouter already default-includes gpt-oss reasoning with
    // no config — this declaration makes the depth explicit and exercises the
    // seam; models that do NOT default-emit need it to see reasoning at all.
    reasoning: { effort: "medium" },
    webSearch: false,
    openSource: true,
    speed: "Fast",
    intelligence: "High",
    website: "https://openrouter.ai",
    apiDocs: "https://openrouter.ai/openai/gpt-oss-120b:free",
    modelPage: "https://openai.com/open-models/",
    releasedAt: "2025-08-05",
    icon: "openai",
  },
  {
    id: "openrouter:meta-llama/llama-3.3-70b-instruct:free",
    name: "Llama 3.3 70B Instruct",
    provider: "OpenRouter",
    providerId: "openrouter",
    catalogStatus: "visible",
    idKind: "wrapped",
    verifiedAgainst: "meta-llama/llama-3.3-70b-instruct:free",
    lastVerifiedAt: "2026-07-04",
    modelFamily: "Llama",
    baseProviderId: "meta",
    description:
      "Meta's Llama 3.3 70B instruction-tuned model, served on OpenRouter's free tier.",
    tags: ["OSS", "tools", "free"],
    contextWindow: 131072,
    inputCost: 0,
    outputCost: 0,
    priceUnit: "per 1M tokens",
    vision: false,
    tools: true,
    audio: false,
    // No `reasoning` in the model's supported_parameters — the previous 8B
    // entry's `reasoningText: true` was spurious.
    reasoningText: false,
    webSearch: true,
    openSource: true,
    speed: "Medium",
    intelligence: "High",
    website: "https://openrouter.ai",
    apiDocs: "https://openrouter.ai/meta-llama/llama-3.3-70b-instruct:free",
    modelPage: "https://www.llama.com/",
    releasedAt: "2024-12-06",
    icon: "meta",
  },
]
