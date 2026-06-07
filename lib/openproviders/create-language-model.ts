import type { LanguageModelV3 } from "@ai-sdk/provider"
import type { ModelConfig } from "@/lib/models/types"
import { resolveModelId } from "@/lib/models/model-id-migration"
import { createProviderLanguageModel } from "./model-factory"

type ModelFactoryInput = string | Pick<ModelConfig, "id">

export function createLanguageModel(
  model: ModelFactoryInput,
  apiKey?: string
): LanguageModelV3 {
  const modelId = typeof model === "string" ? model : model.id
  return createProviderLanguageModel(resolveModelId(modelId), apiKey)
}
