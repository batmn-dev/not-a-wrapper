import { resolveModelId } from "@/lib/models/model-id-migration"
import { getProviderForModel } from "./provider-map"
import {
  getProviderStrategy,
  type ProviderLanguageModel,
} from "./provider-strategy"
import type { SupportedModel } from "./types"

/**
 * Build the AI SDK language model for any supported model id.
 *
 * Provider-specific construction (SDK factory, BYOK-vs-default credentials,
 * OpenRouter's quirks) lives behind the provider strategy; this function only
 * resolves the id, routes it to a provider, and asks that provider's strategy
 * for the model. `getProviderForModel` throws on an unknown provider.
 */
export function createProviderLanguageModel<T extends SupportedModel | string>(
  modelId: T,
  apiKey?: string
): ProviderLanguageModel {
  const resolvedModelId = resolveModelId(modelId)
  const provider = getProviderForModel(resolvedModelId)
  return getProviderStrategy(provider)
    .instance(apiKey)
    .languageModel(resolvedModelId)
}
