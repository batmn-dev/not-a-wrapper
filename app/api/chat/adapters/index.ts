import type { UIMessage } from "ai"
import { anthropicAdapter } from "./anthropic"
import { defaultAdapter } from "./default"
import { googleAdapter } from "./google"
import { openaiAdapter } from "./openai"
import { openaiCompatibleAdapter } from "./openai-compatible"
import { textOnlyAdapter } from "./text-only"
import type {
  AdaptationContext,
  AdaptationResult,
  AdapterRegistry,
  ProviderHistoryAdapter,
} from "./types"

// Vendor prefixes that replay through the OpenAI-compatible adapter: OpenRouter
// normalizes upstream traffic to the OpenAI chat-completions wire shape, and
// that adapter preserves complete tool triples while stripping reasoning (which
// must not be echoed back to reasoning models). Note "x-ai" carries a hyphen —
// the OpenRouter slug prefix, unlike the direct-provider id "xai". This one
// array is the single source of truth: it drives both the known-vendor set and
// the registry wiring below, so adding a vendor is a one-line change that
// cannot desync the two (a mismatch would route history through the wrong
// adapter).
const OPENAI_COMPATIBLE_VENDORS = [
  "xai",
  "mistral",
  "x-ai",
  "deepseek",
  "z-ai",
  "moonshotai",
  "minimax",
  "qwen",
  "meta-llama",
  "xiaomi",
  "inclusionai",
  "nvidia",
  "stealth",
] as const

const KNOWN_UNDERLYING_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  ...OPENAI_COMPATIBLE_VENDORS,
] as const

function extractUnderlyingProvider(
  modelId: string
): (typeof KNOWN_UNDERLYING_PROVIDERS)[number] | null {
  const modelIdWithoutOpenRouterPrefix = modelId.startsWith("openrouter:")
    ? modelId.slice("openrouter:".length)
    : modelId
  const [prefix] = modelIdWithoutOpenRouterPrefix.split("/")
  if (!prefix) return null

  return KNOWN_UNDERLYING_PROVIDERS.includes(
    prefix as (typeof KNOWN_UNDERLYING_PROVIDERS)[number]
  )
    ? (prefix as (typeof KNOWN_UNDERLYING_PROVIDERS)[number])
    : null
}

export const registry: AdapterRegistry = new Map<
  string,
  ProviderHistoryAdapter
>()

registry.set("openai", openaiAdapter)
registry.set("anthropic", anthropicAdapter)
registry.set("google", googleAdapter)
registry.set("perplexity", textOnlyAdapter)
for (const vendor of OPENAI_COMPATIBLE_VENDORS) {
  registry.set(vendor, openaiCompatibleAdapter)
}

export function resolveAdapter(
  providerId: string,
  context: AdaptationContext
): ProviderHistoryAdapter {
  if (providerId === "openrouter") {
    const underlyingProvider = extractUnderlyingProvider(
      context.targetRouteId ?? context.targetModelId
    )
    return (
      (underlyingProvider ? registry.get(underlyingProvider) : null) ??
      defaultAdapter
    )
  }

  return registry.get(providerId) ?? defaultAdapter
}

export async function adaptHistoryForProvider(
  messages: readonly UIMessage[],
  providerId: string,
  context: AdaptationContext
): Promise<AdaptationResult> {
  const adapter = resolveAdapter(providerId, context)
  return adapter.adaptMessages(messages, context)
}
