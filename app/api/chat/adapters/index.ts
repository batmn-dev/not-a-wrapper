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

type AdaptHistoryOptions = {
  useReplayCompiler?: boolean
}

function resolveAdapter(
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
