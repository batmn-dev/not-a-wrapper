/**
 * Provider identity (CONTEXT.md): the single server-safe module owning what
 * is identically true about a key-bearing provider everywhere it appears —
 * the id unions, company display names, the provider→vendor link, key-setup
 * facts, and the known-vendor registry.
 *
 * Two vocabularies live here, deliberately distinct:
 *
 *   - **Provider** / **ToolProvider** — the closed, key-bearing API surfaces.
 *     Model providers each have a Provider strategy; both kinds share the
 *     encrypted `userKeys` storage (`KeyedProvider`).
 *   - **Vendor** — the open-set presentation identity of a model's maker
 *     (icon + display name). The catalog's `icon`/`baseProviderId` fields
 *     point into vendor space; wrapped OpenRouter models may carry vendor ids
 *     with no registry entry and fall back to the OpenRouter icon.
 *
 * Key-settings tiles use the provider's COMPANY identity (Anthropic, Google,
 * xAI) — never the product brand; model rows keep vendor identity.
 *
 * Deliberately excluded: the Provider strategy's static SDK facts — the
 * model-provider env-var name stays on the strategy (provider-strategy.ts);
 * identity is what the UI and key storage agree on, not how an SDK is built.
 * Icons are React components and live in the client-only sibling registry
 * (`lib/provider-icons.tsx`), keyed by the same vendor ids.
 */

// Key-bearing provider ids

/** Order is the key-settings tile order. */
export const MODEL_PROVIDER_IDS = [
  "openrouter",
  "openai",
  "mistral",
  "google",
  "perplexity",
  "xai",
  "anthropic",
] as const

export type Provider = (typeof MODEL_PROVIDER_IDS)[number]

export const TOOL_PROVIDER_IDS = ["exa", "firecrawl"] as const

export type ToolProvider = (typeof TOOL_PROVIDER_IDS)[number]

/** Every id that may own a row in the encrypted `userKeys` storage. */
export type KeyedProvider = Provider | ToolProvider

// Vendor registry

export type KnownVendorId =
  | "openrouter"
  | "openai"
  | "mistral"
  | "deepseek"
  | "gemini"
  | "claude"
  | "grok"
  | "xai"
  | "google"
  | "anthropic"
  | "meta"
  | "perplexity"
  | "moonshotai"
  | "z-ai"
  | "nvidia"
  | "minimax"
  | "qwen"
  | "xiaomi"
  | "inclusionai"

export type VendorIdentity = {
  id: KnownVendorId
  name: string
}

export const VENDORS: Record<KnownVendorId, VendorIdentity> = {
  openrouter: { id: "openrouter", name: "OpenRouter" },
  openai: { id: "openai", name: "OpenAI" },
  mistral: { id: "mistral", name: "Mistral" },
  deepseek: { id: "deepseek", name: "DeepSeek" },
  gemini: { id: "gemini", name: "Gemini" },
  claude: { id: "claude", name: "Claude" },
  grok: { id: "grok", name: "Grok" },
  xai: { id: "xai", name: "xAI" },
  google: { id: "google", name: "Google" },
  anthropic: { id: "anthropic", name: "Anthropic" },
  meta: { id: "meta", name: "Meta" },
  perplexity: { id: "perplexity", name: "Perplexity" },
  moonshotai: { id: "moonshotai", name: "Moonshot AI" },
  "z-ai": { id: "z-ai", name: "Z.ai" },
  nvidia: { id: "nvidia", name: "NVIDIA" },
  minimax: { id: "minimax", name: "MiniMax" },
  qwen: { id: "qwen", name: "Qwen" },
  xiaomi: { id: "xiaomi", name: "Xiaomi" },
  inclusionai: { id: "inclusionai", name: "inclusionAI" },
}

export function isKnownVendorId(id: string): id is KnownVendorId {
  return id in VENDORS
}

/** Vendor identity for an open-set vendor id; undefined when unregistered. */
export function getVendor(id: string): VendorIdentity | undefined {
  return isKnownVendorId(id) ? VENDORS[id] : undefined
}

// Model-provider identity

export type ProviderKeySetup = {
  placeholder: string
  getKeyUrl: string
  /** Shown in the password field when a key is stored. */
  maskHint: string
}

export type ModelProviderIdentity = {
  id: Provider
  /** Company display name — what key settings show. */
  name: string
  /** The company's own vendor identity (its icon), not its product brand. */
  vendorId: KnownVendorId
  keySetup: ProviderKeySetup
}

export const MODEL_PROVIDER_IDENTITY: Record<Provider, ModelProviderIdentity> =
  {
    openrouter: {
      id: "openrouter",
      name: "OpenRouter",
      vendorId: "openrouter",
      keySetup: {
        placeholder: "sk-or-v1-...",
        getKeyUrl: "https://openrouter.ai/settings/keys",
        maskHint: "sk-or-v1-............",
      },
    },
    openai: {
      id: "openai",
      name: "OpenAI",
      vendorId: "openai",
      keySetup: {
        placeholder: "sk-...",
        getKeyUrl: "https://platform.openai.com/api-keys",
        maskHint: "sk-............",
      },
    },
    mistral: {
      id: "mistral",
      name: "Mistral",
      vendorId: "mistral",
      keySetup: {
        placeholder: "...",
        getKeyUrl: "https://console.mistral.ai/api-keys/",
        maskHint: "............",
      },
    },
    google: {
      id: "google",
      name: "Google",
      vendorId: "google",
      keySetup: {
        placeholder: "AIza...",
        getKeyUrl: "https://ai.google.dev/gemini-api/docs/api-key",
        maskHint: "AIza............",
      },
    },
    perplexity: {
      id: "perplexity",
      name: "Perplexity",
      vendorId: "perplexity",
      keySetup: {
        placeholder: "pplx-...",
        getKeyUrl: "https://docs.perplexity.ai/guides/getting-started",
        maskHint: "pplx-............",
      },
    },
    xai: {
      id: "xai",
      name: "xAI",
      vendorId: "xai",
      keySetup: {
        placeholder: "xai-...",
        getKeyUrl: "https://console.x.ai/",
        maskHint: "xai-............",
      },
    },
    anthropic: {
      id: "anthropic",
      name: "Anthropic",
      vendorId: "anthropic",
      keySetup: {
        placeholder: "sk-ant-...",
        getKeyUrl: "https://console.anthropic.com/settings/keys",
        maskHint: "sk-ant-............",
      },
    },
  }

// Tool-provider identity

export type ToolProviderIdentity = {
  id: ToolProvider
  name: string
  description: string
  costEstimate: string
  /** false → not selectable in key settings ("coming soon"). */
  available: boolean
  /**
   * Platform env var for the fallback key. Tool providers have no Provider
   * strategy, so — unlike model providers — the env-var name lives here.
   */
  envVarName: string
  keySetup: Pick<ProviderKeySetup, "placeholder" | "getKeyUrl">
}

export const TOOL_PROVIDER_IDENTITY: Record<ToolProvider, ToolProviderIdentity> =
  {
    exa: {
      id: "exa",
      name: "Exa",
      description:
        "AI-native web search. Powers search for models without built-in search, such as Mistral.",
      costEstimate: "~$0.005 per search",
      available: true,
      envVarName: "EXA_API_KEY",
      keySetup: {
        placeholder: "exa-...",
        getKeyUrl: "https://dashboard.exa.ai/api-keys",
      },
    },
    firecrawl: {
      id: "firecrawl",
      name: "Firecrawl",
      description:
        "Web scraping and content extraction. Enables structured data extraction from web pages.",
      costEstimate: "~$0.001 per page",
      available: false,
      envVarName: "FIRECRAWL_API_KEY",
      keySetup: {
        placeholder: "fc-...",
        getKeyUrl: "https://www.firecrawl.dev/app/api-keys",
      },
    },
  }
