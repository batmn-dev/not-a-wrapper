import type { ModelConfig } from "@/lib/models/types"
import {
  getProviderStrategy,
  type ProviderLanguageModel,
} from "./provider-strategy"

export function createLanguageModel(
  route: ModelConfig,
  apiKey?: string
): ProviderLanguageModel {
  return getProviderStrategy(route.providerId)
    .instance(apiKey)
    .languageModel(
      route.id,
      route.reasoning ? { reasoning: route.reasoning } : undefined
    )
}
