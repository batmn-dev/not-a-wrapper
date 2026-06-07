import type { LanguageModelV3 } from "@ai-sdk/provider"
import { createProviderLanguageModel } from "./model-factory"
import type { SupportedModel } from "./types"

/**
 * Create a language model instance for any supported provider.
 * 
 * In AI SDK v5+, provider-specific settings are passed via `providerOptions`
 * in streamText/generateText calls, not at model instantiation.
 * 
 * @param modelId - The model identifier (e.g., "gpt-4.1", "claude-3-5-sonnet-latest")
 * @param _settings - Deprecated: settings parameter (kept for backward compatibility, not used)
 * @param apiKey - Optional API key (uses environment variable if not provided)
 * @returns LanguageModelV3 instance
 */
export function openproviders<T extends SupportedModel>(
  modelId: T,
  _settings?: unknown,
  apiKey?: string
): LanguageModelV3 {
  return createProviderLanguageModel(modelId, apiKey)
}
