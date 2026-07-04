import { FREE_MODELS_IDS } from "../config"
import { claudeModels } from "./data/claude"
import { deepseekModels } from "./data/deepseek"
import { geminiModels } from "./data/gemini"
import { grokModels } from "./data/grok"
import { mistralModels } from "./data/mistral"
import { openaiModels } from "./data/openai"
import { openrouterModels } from "./data/openrouter"
import { perplexityModels } from "./data/perplexity"
import { resolveModelId } from "./model-id-migration"
import { ModelConfig } from "./types"

// Static models (always available)
const STATIC_MODELS: ModelConfig[] = [
  ...openaiModels,
  ...mistralModels,
  ...deepseekModels,
  ...claudeModels,
  ...grokModels,
  ...perplexityModels,
  ...geminiModels,
  ...openrouterModels,
]

function withBaseAccessFlags(models: ModelConfig[]): ModelConfig[] {
  return models.map((model) => ({
    ...model,
    accessible: FREE_MODELS_IDS.includes(model.id),
  }))
}

export function isVisibleModel(
  model: Pick<ModelConfig, "catalogStatus">
): boolean {
  return model.catalogStatus === "visible"
}

// Function to get all models
export async function getAllModels(): Promise<ModelConfig[]> {
  return STATIC_MODELS
}

export async function getRoutableModelsWithAccessFlags(): Promise<
  ModelConfig[]
> {
  return withBaseAccessFlags(await getAllModels())
}

export async function getVisibleModels(): Promise<ModelConfig[]> {
  const models = await getAllModels()
  return models.filter((model) => isVisibleModel(model))
}

export async function getVisibleModelsWithAccessFlags(): Promise<
  ModelConfig[]
> {
  return withBaseAccessFlags(await getVisibleModels())
}

export async function getModelsForProvider(
  provider: string
): Promise<ModelConfig[]> {
  const models = STATIC_MODELS

  const providerModels = models
    .filter((model) => model.providerId === provider)
    .map((model) => ({
      ...model,
      accessible: true,
    }))

  return providerModels
}

// Function to get models based on user's available providers
export async function getModelsForUserProviders(
  providers: string[]
): Promise<ModelConfig[]> {
  const providerModels = await Promise.all(
    providers.map((provider) => getModelsForProvider(provider))
  )

  const flatProviderModels = providerModels.flat()

  return flatProviderModels
}

// Synchronous function to get model info for simple lookups
export function getModelInfo(modelId: string): ModelConfig | undefined {
  const resolvedModelId = resolveModelId(modelId)
  return STATIC_MODELS.find((model) => model.id === resolvedModelId)
}

// For backward compatibility - static models only
export const MODELS: ModelConfig[] = STATIC_MODELS
