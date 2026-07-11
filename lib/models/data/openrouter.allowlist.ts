import type { ModelConfig } from "../types"

/**
 * Curated OpenRouter allowlist — the EDITORIAL half of the generated catalog.
 *
 * `scripts/generate-openrouter-catalog.ts` joins this list with the committed
 * `openrouter.snapshot.json` (the MACHINE half: pricing, context, capability
 * parameters, listing existence) and emits `openrouter.generated.ts`. Facts
 * that rot live in the snapshot; anything a human should word or rank lives
 * here. Refresh: `bun run catalog:openrouter:refresh`.
 *
 * Curation policy (see docs/adr/0007-snapshot-generated-openrouter-catalog.md):
 * per vendor
 * keep at most flagship + workhorse (+1 specialist where the family warrants
 * it, e.g. coder), cap ~4/vendor (Anthropic) and ~2-3 elsewhere. `:free` pool
 * entries must have `tools` or `reasoning` in `supported_parameters` AND
 * ctx ≥ 128k, cap ~6. Anything delisted at snapshot time gets removed here
 * plus a succession entry in `lib/models/model-id-migration.ts`.
 *
 * Deliberately excluded (2026-07-05 curation — don't re-litigate without new
 * evidence):
 * - `openai/gpt-5.5-pro` / `gpt-5.4-pro` wrapped ($30/$180; the direct
 *   catalog already carries 5.4-pro), `o3`/`o3-pro` (previous gen).
 * - `anthropic/*-fast` variants (2× price for the same models).
 * - `x-ai/grok-build-0.1` (xAI "Code API" product — unverified on the chat
 *   surface), `x-ai/grok-4.20*` (superseded by 4.3).
 * - `openrouter/auto|free|fusion` router pseudo-models (variable-pricing
 *   sentinel `-1000000`).
 * - Image/audio/video models (Nano Banana, Lyria, Imagine, GPT-Image,
 *   TTS/Live).
 * - `moonshotai/kimi-k2.7-code` (16k maxOut, code-only),
 *   `minimax/minimax-m2-her` (no tools, 2k maxOut).
 * - "Owl Alpha" from the competitive reference list has NO live match (likely
 *   a delisted stealth model) — do not invent an entry for it.
 *
 * Free-pool alternates seen live 2026-07-04, for future refresh
 * consideration: `poolside/laguna-xs-2.1:free`, `cohere/north-mini-code:free`,
 * `nvidia/nemotron-3-super-120b-a12b:free`, `openai/gpt-oss-20b:free`.
 */
export type OpenRouterAllowlistEntry = {
  /** Bare OpenRouter slug (the generated id is `openrouter:` + slug). */
  slug: string
  name: string
  description: string
  tags: string[]
  modelFamily: string
  /**
   * Real underlying vendor. When it is not in the Vendor registry
   * (`lib/provider-identity.ts`), icon lookups fall back to the OpenRouter
   * icon.
   */
  baseProviderId: string
  /** Vendor-registry icon key; "openrouter" when the vendor has no own icon. */
  icon: string
  speed: NonNullable<ModelConfig["speed"]>
  intelligence: NonNullable<ModelConfig["intelligence"]>
  openSource: boolean
  /** Overrides the snapshot-derived listing date (`created`) when set. */
  releasedAt?: string
  modelPage?: string
  /**
   * Opt OUT of reasoning config even when the live `supported_parameters`
   * include `reasoning`. The generator can never opt IN without the live
   * parameter — reasoning support is a machine fact, not an editorial one.
   */
  reasoningOptOut?: boolean
}

// Note on webSearch: the previous hand-authored Llama entry carried
// `webSearch: true` by mistake — OpenRouter exposes no native search tool on
// this path, so the generator emits `webSearch: false` for every wrapped
// entry (deliberate correction, 2026-07-05).
export const OPENROUTER_ALLOWLIST: readonly OpenRouterAllowlistEntry[] = [
  // ——— Free tier (also see FREE_MODELS_IDS in lib/config.ts — membership
  // there is a Phase 6 / owner decision, not something this file controls) ———
  {
    slug: "openai/gpt-oss-120b:free",
    name: "GPT-OSS 120B",
    description:
      "OpenAI's open-weight 120B MoE reasoning model (Apache 2.0), served on OpenRouter's free tier.",
    tags: ["reasoning", "OSS", "free"],
    modelFamily: "GPT-OSS",
    baseProviderId: "openai",
    icon: "openai",
    speed: "Fast",
    intelligence: "High",
    openSource: true,
    modelPage: "https://openai.com/open-models/",
  },
  {
    slug: "meta-llama/llama-3.3-70b-instruct:free",
    name: "Llama 3.3 70B Instruct",
    description:
      "Meta's Llama 3.3 70B instruction-tuned model, served on OpenRouter's free tier.",
    tags: ["OSS", "tools", "free"],
    modelFamily: "Llama",
    baseProviderId: "meta",
    icon: "meta",
    speed: "Medium",
    intelligence: "High",
    openSource: true,
    modelPage: "https://www.llama.com/",
  },
  {
    slug: "qwen/qwen3-coder:free",
    name: "Qwen3 Coder (Free)",
    description:
      "Qwen's open-weight 480B-A35B coding MoE with a 1M-token context, served on OpenRouter's free tier.",
    tags: ["coding", "tools", "OSS", "free"],
    modelFamily: "Qwen3",
    baseProviderId: "qwen",
    icon: "openrouter",
    speed: "Medium",
    intelligence: "High",
    openSource: true,
  },
  {
    slug: "google/gemma-4-26b-a4b-it:free",
    name: "Gemma 4 26B",
    description:
      "Google's open-weight Gemma 4 26B (A4B MoE) instruction-tuned model with vision, served on OpenRouter's free tier.",
    tags: ["OSS", "vision", "reasoning", "free"],
    modelFamily: "Gemma",
    baseProviderId: "google",
    icon: "google",
    speed: "Fast",
    intelligence: "Medium",
    openSource: true,
  },
  {
    slug: "nvidia/nemotron-3-ultra-550b-a55b:free",
    name: "Nemotron 3 Ultra 550B",
    description:
      "NVIDIA's open 550B-A55B reasoning MoE with a 1M-token context, served on OpenRouter's free tier.",
    tags: ["reasoning", "OSS", "free"],
    modelFamily: "Nemotron",
    baseProviderId: "nvidia",
    icon: "openrouter",
    speed: "Medium",
    intelligence: "High",
    openSource: true,
  },
  // ——— Paid, BYOK-gated (server 401s without a user OpenRouter key) ———
  {
    slug: "anthropic/claude-sonnet-5",
    name: "Claude Sonnet 5",
    description:
      "Anthropic's Claude Sonnet 5 via OpenRouter — frontier coding and agent performance at intro pricing ($2/$10 through 2026-08-31, then $3/$15).",
    tags: ["flagship", "reasoning", "coding", "vision"],
    modelFamily: "Claude 5",
    baseProviderId: "anthropic",
    icon: "claude",
    speed: "Fast",
    intelligence: "High",
    openSource: false,
  },
  {
    slug: "anthropic/claude-opus-4.8",
    name: "Claude Opus 4.8",
    description:
      "Anthropic's Claude Opus 4.8 via OpenRouter — deep-reasoning flagship with a 1M-token context.",
    tags: ["flagship", "reasoning", "agents", "coding"],
    modelFamily: "Claude 4.8",
    baseProviderId: "anthropic",
    icon: "claude",
    speed: "Medium",
    intelligence: "High",
    openSource: false,
  },
  {
    slug: "anthropic/claude-fable-5",
    name: "Claude Fable 5",
    description:
      "Anthropic's Mythos-tier Claude Fable 5 via OpenRouter. Safety classifiers may end dual-use asks with a refusal stop reason, and upstream restricts serving to 30-day-retention orgs.",
    tags: ["flagship", "reasoning", "agents", "vision"],
    modelFamily: "Claude 5",
    baseProviderId: "anthropic",
    icon: "claude",
    speed: "Medium",
    intelligence: "High",
    openSource: false,
  },
  {
    slug: "anthropic/claude-haiku-4.5",
    name: "Claude Haiku 4.5",
    description:
      "Anthropic's fastest Claude tier via OpenRouter — near-frontier intelligence at low cost.",
    tags: ["fast", "cheap", "reasoning"],
    modelFamily: "Claude 4.5",
    baseProviderId: "anthropic",
    icon: "claude",
    speed: "Fast",
    intelligence: "Medium",
    openSource: false,
  },
  {
    slug: "openai/gpt-5.5",
    name: "GPT-5.5",
    description:
      "OpenAI's GPT-5.5 flagship via OpenRouter — 1M-token-context reasoning generalist.",
    tags: ["flagship", "reasoning", "vision"],
    modelFamily: "GPT-5",
    baseProviderId: "openai",
    icon: "openai",
    speed: "Medium",
    intelligence: "High",
    openSource: false,
  },
  {
    slug: "openai/gpt-5.4",
    name: "GPT-5.4",
    description:
      "OpenAI's GPT-5.4 workhorse via OpenRouter — strong reasoning at mid-tier pricing.",
    tags: ["reasoning", "vision"],
    modelFamily: "GPT-5",
    baseProviderId: "openai",
    icon: "openai",
    speed: "Medium",
    intelligence: "High",
    openSource: false,
  },
  {
    slug: "openai/gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    description:
      "OpenAI's GPT-5.4 Mini via OpenRouter — fast, low-cost reasoning tier.",
    tags: ["fast", "cheap", "reasoning"],
    modelFamily: "GPT-5",
    baseProviderId: "openai",
    icon: "openai",
    speed: "Fast",
    intelligence: "Medium",
    openSource: false,
  },
  {
    slug: "google/gemini-3.5-flash",
    name: "Gemini 3.5 Flash",
    description:
      "Google's Gemini 3.5 Flash via OpenRouter — fast multimodal reasoning with a 1M-token context.",
    tags: ["fast", "reasoning", "vision"],
    modelFamily: "Gemini 3.5",
    baseProviderId: "google",
    icon: "gemini",
    speed: "Fast",
    intelligence: "High",
    openSource: false,
  },
  {
    slug: "google/gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro (Preview)",
    description:
      "Google's Gemini 3.1 Pro preview via OpenRouter — flagship multimodal reasoning. Preview id: retire with a succession entry when the stable ships.",
    tags: ["flagship", "reasoning", "vision", "preview"],
    modelFamily: "Gemini 3.1",
    baseProviderId: "google",
    icon: "gemini",
    speed: "Medium",
    intelligence: "High",
    openSource: false,
  },
  {
    slug: "google/gemini-3.1-flash-lite",
    name: "Gemini 3.1 Flash Lite",
    description:
      "Google's cheapest Gemini 3.1 tier via OpenRouter — high-volume multimodal workhorse.",
    tags: ["fast", "cheap", "vision"],
    modelFamily: "Gemini 3.1",
    baseProviderId: "google",
    icon: "gemini",
    speed: "Fast",
    intelligence: "Medium",
    openSource: false,
  },
  {
    slug: "x-ai/grok-4.3",
    name: "Grok 4.3",
    description:
      "xAI's Grok 4.3 via OpenRouter — 1M-token-context reasoning flagship.",
    tags: ["flagship", "reasoning", "vision"],
    modelFamily: "Grok 4",
    baseProviderId: "xai",
    icon: "grok",
    speed: "Medium",
    intelligence: "High",
    openSource: false,
  },
  {
    slug: "deepseek/deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    description:
      "DeepSeek's V4 Pro via OpenRouter — open-weight frontier reasoning at aggressive pricing.",
    tags: ["reasoning", "OSS", "cheap"],
    modelFamily: "DeepSeek V4",
    baseProviderId: "deepseek",
    icon: "deepseek",
    speed: "Medium",
    intelligence: "High",
    openSource: true,
  },
  {
    slug: "deepseek/deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    description:
      "DeepSeek's fast V4 tier via OpenRouter — very low cost with reasoning support.",
    tags: ["fast", "cheap", "reasoning", "OSS"],
    modelFamily: "DeepSeek V4",
    baseProviderId: "deepseek",
    icon: "deepseek",
    speed: "Fast",
    intelligence: "Medium",
    openSource: true,
  },
  {
    slug: "z-ai/glm-5.2",
    name: "GLM 5.2",
    description:
      "Z.ai's GLM 5.2 via OpenRouter — open-weight 1M-context reasoning and coding model.",
    tags: ["reasoning", "coding", "OSS"],
    modelFamily: "GLM",
    baseProviderId: "z-ai",
    icon: "openrouter",
    speed: "Medium",
    intelligence: "High",
    openSource: true,
  },
  {
    slug: "z-ai/glm-5",
    name: "GLM 5",
    description:
      "Z.ai's GLM 5 via OpenRouter — the previous open-weight flagship generation.",
    tags: ["reasoning", "OSS"],
    modelFamily: "GLM",
    baseProviderId: "z-ai",
    icon: "openrouter",
    speed: "Medium",
    intelligence: "High",
    openSource: true,
  },
  {
    slug: "moonshotai/kimi-k2.6",
    name: "Kimi K2.6",
    description:
      "Moonshot AI's Kimi K2.6 via OpenRouter — open-weight agentic MoE with vision.",
    tags: ["agents", "reasoning", "vision", "OSS"],
    modelFamily: "Kimi K2",
    baseProviderId: "moonshotai",
    icon: "openrouter",
    speed: "Medium",
    intelligence: "High",
    openSource: true,
  },
  {
    slug: "minimax/minimax-m3",
    name: "MiniMax M3",
    description:
      "MiniMax's M3 via OpenRouter — open-weight 1M-context reasoner with vision and huge output budgets.",
    tags: ["reasoning", "vision", "OSS"],
    modelFamily: "MiniMax M",
    baseProviderId: "minimax",
    icon: "openrouter",
    speed: "Medium",
    intelligence: "High",
    openSource: true,
  },
  {
    slug: "minimax/minimax-m2.5",
    name: "MiniMax M2.5",
    description:
      "MiniMax's M2.5 via OpenRouter — cheap agentic workhorse with reasoning support.",
    tags: ["cheap", "reasoning", "OSS"],
    modelFamily: "MiniMax M",
    baseProviderId: "minimax",
    icon: "openrouter",
    speed: "Fast",
    intelligence: "Medium",
    openSource: true,
  },
  {
    slug: "qwen/qwen3.7-max",
    name: "Qwen3.7 Max",
    description:
      "Alibaba's Qwen3.7 Max via OpenRouter — 1M-context flagship of the Qwen family.",
    tags: ["flagship", "reasoning"],
    modelFamily: "Qwen3.7",
    baseProviderId: "qwen",
    icon: "openrouter",
    speed: "Medium",
    intelligence: "High",
    openSource: false,
  },
  {
    slug: "qwen/qwen3-coder",
    name: "Qwen3 Coder",
    description:
      "Qwen's open-weight 480B-A35B coding MoE via OpenRouter — the paid endpoint, without the free pool's rate caps.",
    tags: ["coding", "tools", "OSS"],
    modelFamily: "Qwen3",
    baseProviderId: "qwen",
    icon: "openrouter",
    speed: "Medium",
    intelligence: "High",
    openSource: true,
  },
  {
    slug: "meta-llama/llama-4-maverick",
    name: "Llama 4 Maverick",
    description:
      "Meta's Llama 4 Maverick via OpenRouter — open-weight multimodal MoE with a 1M-token context.",
    tags: ["OSS", "vision", "cheap"],
    modelFamily: "Llama 4",
    baseProviderId: "meta",
    icon: "meta",
    speed: "Fast",
    intelligence: "Medium",
    openSource: true,
    modelPage: "https://www.llama.com/",
  },
  {
    slug: "xiaomi/mimo-v2.5",
    name: "MiMo V2.5",
    description:
      "Xiaomi's MiMo V2.5 via OpenRouter — open-weight multimodal reasoner at very low cost.",
    tags: ["cheap", "reasoning", "vision", "OSS"],
    modelFamily: "MiMo",
    baseProviderId: "xiaomi",
    icon: "openrouter",
    speed: "Fast",
    intelligence: "Medium",
    openSource: true,
  },
  {
    slug: "inclusionai/ling-2.6-flash",
    name: "Ling 2.6 Flash",
    description:
      "inclusionAI's Ling 2.6 Flash via OpenRouter — ultra-cheap open-weight workhorse.",
    tags: ["cheap", "fast", "OSS"],
    modelFamily: "Ling",
    baseProviderId: "inclusionai",
    icon: "openrouter",
    speed: "Fast",
    intelligence: "Medium",
    openSource: true,
  },
]
