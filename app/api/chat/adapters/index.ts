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

const KNOWN_UNDERLYING_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "xai",
  "mistral",
  // OpenRouter slug vendor prefixes (note "x-ai" with hyphen, unlike direct "xai")
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
registry.set("xai", openaiCompatibleAdapter)
registry.set("mistral", openaiCompatibleAdapter)
registry.set("perplexity", textOnlyAdapter)
// OpenRouter-wrapped vendors: OpenRouter normalizes upstream traffic to the
// OpenAI chat-completions wire shape, so replay history the same way — the
// openai-compatible adapter preserves complete tool triples and strips
// reasoning (which must not be echoed back to reasoning models).
registry.set("x-ai", openaiCompatibleAdapter)
registry.set("deepseek", openaiCompatibleAdapter)
registry.set("z-ai", openaiCompatibleAdapter)
registry.set("moonshotai", openaiCompatibleAdapter)
registry.set("minimax", openaiCompatibleAdapter)
registry.set("qwen", openaiCompatibleAdapter)
registry.set("meta-llama", openaiCompatibleAdapter)
registry.set("xiaomi", openaiCompatibleAdapter)
registry.set("inclusionai", openaiCompatibleAdapter)
registry.set("nvidia", openaiCompatibleAdapter)

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
