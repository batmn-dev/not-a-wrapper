import type { ModelConfig } from "@/lib/models/types"
import { createProviderLanguageModel } from "./model-factory"
import type { ProviderLanguageModel } from "./provider-strategy"

// Construction settings come from the catalog entry, so only config inputs
// carry them — a bare string id (used by tests and ad-hoc callers) builds the
// model without construction-time configuration.
type ModelFactoryInput = string | Pick<ModelConfig, "id" | "reasoning">

export function createLanguageModel(
  model: ModelFactoryInput,
  apiKey?: string
): ProviderLanguageModel {
  if (typeof model === "string") {
    return createProviderLanguageModel(model, apiKey)
  }
  return createProviderLanguageModel(
    model.id,
    apiKey,
    model.reasoning ? { reasoning: model.reasoning } : undefined
  )
}
