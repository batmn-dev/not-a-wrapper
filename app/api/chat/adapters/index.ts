import type { UIMessage } from "ai"
import { compileReplay } from "../replay/compilers"
import { normalizeReplayMessages } from "../replay/normalize"
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

type AdaptHistoryOptions = {
  useReplayCompiler?: boolean
}

export function resolveAdapter(
  providerId: string,
  context: AdaptationContext
): { adapter: ProviderHistoryAdapter; effectiveProviderId: string } {
  if (providerId === "openrouter") {
    const underlyingProvider = extractUnderlyingProvider(context.targetModelId)
    const effectiveProviderId = underlyingProvider ?? "default"
    return {
      adapter:
        (underlyingProvider ? registry.get(underlyingProvider) : null) ??
        defaultAdapter,
      effectiveProviderId,
    }
  }

  return {
    adapter: registry.get(providerId) ?? defaultAdapter,
    effectiveProviderId: registry.has(providerId) ? providerId : "default",
  }
}

function formatReplayError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  return "Unknown replay compile error"
}

export async function adaptHistoryForProvider(
  messages: readonly UIMessage[],
  providerId: string,
  context: AdaptationContext,
  options: AdaptHistoryOptions = {}
): Promise<AdaptationResult> {
  const { adapter, effectiveProviderId } = resolveAdapter(providerId, context)

  if (!options.useReplayCompiler) {
    return adapter.adaptMessages(messages, context)
  }

  try {
    const normalization = normalizeReplayMessages(messages)
    const compiled = await compileReplay(
      normalization.messages,
      effectiveProviderId,
      context
    )
    const adapted = await adapter.adaptMessages(compiled.messages, context)

    return {
      ...adapted,
      warnings: [
        ...adapted.warnings,
        ...normalization.warnings.map((warning) => ({
          code: "replay_normalization_warning" as const,
          messageIndex: warning.messageIndex,
          detail: `${warning.code}: ${warning.detail}`,
        })),
        ...compiled.warnings.map((warning) => ({
          code: "replay_compile_warning" as const,
          messageIndex: warning.messageIndex,
          detail: `${warning.code}: ${warning.detail}`,
        })),
      ],
    }
  } catch (error) {
    const fallbackResult = await adapter.adaptMessages(messages, context)
    const detail = formatReplayError(error)

    console.warn(
      `[history-replay] compiler fallback -> legacy adapter (${effectiveProviderId}): ${detail}`
    )

    return {
      ...fallbackResult,
      warnings: [
        ...fallbackResult.warnings,
        {
          code: "replay_compile_fallback",
          messageIndex: 0,
          detail: `Replay compile failed and legacy adapter path was used: ${detail}`,
        },
      ],
    }
  }
}
