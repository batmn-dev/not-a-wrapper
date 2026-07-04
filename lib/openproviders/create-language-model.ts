import { resolveModelId } from "@/lib/models/model-id-migration"
import type { ModelConfig } from "@/lib/models/types"
import { createProviderLanguageModel } from "./model-factory"
import type { ProviderLanguageModel } from "./provider-strategy"

type ModelFactoryInput = string | Pick<ModelConfig, "id">

export function createLanguageModel(
  model: ModelFactoryInput,
  apiKey?: string
): ProviderLanguageModel {
  const modelId = typeof model === "string" ? model : model.id
  return createProviderLanguageModel(resolveModelId(modelId), apiKey)
}
