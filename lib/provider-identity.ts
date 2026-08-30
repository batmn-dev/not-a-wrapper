/**
 * Providers are closed, key-bearing API surfaces; vendors are open-set model
 * maker identities. Key settings use company identity while model rows use
 * vendor identity. SDK construction stays in provider strategies and icons in
 * the client-only provider-icons registry.
 */

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

export const TOOL_PROVIDER_IDS = ["exa"] as const

export type ToolProvider = (typeof TOOL_PROVIDER_IDS)[number]

/** Every id that may own a row in the encrypted `userKeys` storage. */
export type KeyedProvider = Provider | ToolProvider

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

export function getVendor(id: string): VendorIdentity | undefined {
  return isKnownVendorId(id) ? VENDORS[id] : undefined
}

export type ProviderKeySetup = {
  placeholder: string
  getKeyUrl: string
  maskHint: string
}

export type ModelProviderIdentity = {
  id: Provider
  name: string
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

export type ToolProviderIdentity = {
  id: ToolProvider
  name: string
  description: string
  costEstimate: string
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
      envVarName: "EXA_API_KEY",
      keySetup: {
        placeholder: "exa-...",
        getKeyUrl: "https://dashboard.exa.ai/api-keys",
      },
    },
  }
