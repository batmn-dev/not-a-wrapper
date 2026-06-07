import { anthropic, createAnthropic } from "@ai-sdk/anthropic"
import { createGoogleGenerativeAI, google } from "@ai-sdk/google"
import { createMistral, mistral } from "@ai-sdk/mistral"
import { createOpenAI, openai } from "@ai-sdk/openai"
import { createPerplexity, perplexity } from "@ai-sdk/perplexity"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { createXai, xai } from "@ai-sdk/xai"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { getProviderForModel } from "./provider-map"
import type {
  AnthropicModel,
  GeminiModel,
  MistralModel,
  OpenAIModel,
  OpenRouterModel,
  PerplexityModel,
  SupportedModel,
  XaiModel,
} from "./types"

function toOpenRouterChatModelId(modelId: string): string {
  return modelId.startsWith("openrouter:")
    ? modelId.slice("openrouter:".length)
    : modelId
}

export function createProviderLanguageModel<T extends SupportedModel | string>(
  modelId: T,
  apiKey?: string
): LanguageModelV3 {
  const provider = getProviderForModel(modelId)

  if (provider === "openai") {
    if (apiKey) {
      const openaiProvider = createOpenAI({ apiKey })
      return openaiProvider(modelId as OpenAIModel)
    }
    return openai(modelId as OpenAIModel)
  }

  if (provider === "mistral") {
    if (apiKey) {
      const mistralProvider = createMistral({ apiKey })
      return mistralProvider(modelId as MistralModel)
    }
    return mistral(modelId as MistralModel)
  }

  if (provider === "google") {
    if (apiKey) {
      const googleProvider = createGoogleGenerativeAI({ apiKey })
      return googleProvider(modelId as GeminiModel)
    }
    return google(modelId as GeminiModel)
  }

  if (provider === "perplexity") {
    if (apiKey) {
      const perplexityProvider = createPerplexity({ apiKey })
      return perplexityProvider(modelId as PerplexityModel)
    }
    return perplexity(modelId as PerplexityModel)
  }

  if (provider === "anthropic") {
    if (apiKey) {
      const anthropicProvider = createAnthropic({ apiKey })
      return anthropicProvider(modelId as AnthropicModel)
    }
    return anthropic(modelId as AnthropicModel)
  }

  if (provider === "xai") {
    if (apiKey) {
      const xaiProvider = createXai({ apiKey })
      return xaiProvider(modelId as XaiModel)
    }
    return xai(modelId as XaiModel)
  }

  if (provider === "openrouter") {
    const openrouterProvider = createOpenRouter({
      apiKey: apiKey || process.env.OPENROUTER_API_KEY,
    })
    return openrouterProvider.chat(
      toOpenRouterChatModelId(modelId as OpenRouterModel)
    )
  }

  throw new Error(`Unsupported model: ${modelId}`)
}
