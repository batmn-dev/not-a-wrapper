import { getDefaultModelForUser, NON_AUTH_ALLOWED_MODELS } from "@/lib/config"
import { getModelInfo } from "@/lib/models"
import { resolveModelId } from "@/lib/models/model-id-migration"
import { ModelConfig } from "@/lib/models/types"

/**
 * Curated default model order for the model selector.
 * Models in this list appear first, in the exact order specified.
 * Models not in this list preserve their original array-declaration order.
 */
export const DEFAULT_MODEL_ORDER: string[] = [
  "claude-opus-4-8",
  "claude-fable-5",
  "claude-sonnet-5",
  "claude-haiku-4-5-20251001",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-pro",
  "gpt-5.4-mini",
  "gpt-5-mini",
  "gemini-3.1-pro-preview",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "grok-4.3",
  "mistral-large-2512",
  "mistral-small-2506",
  "codestral-2508",
  "sonar",
  "sonar-reasoning-pro",
  // Wrapped OpenRouter entries: frees first, then the paid set in the
  // allowlist's curated order (lib/models/data/openrouter.allowlist.ts).
  "openrouter:openai/gpt-oss-120b:free",
  "openrouter:meta-llama/llama-3.3-70b-instruct:free",
  "openrouter:qwen/qwen3-coder:free",
  "openrouter:google/gemma-4-26b-a4b-it:free",
  "openrouter:nvidia/nemotron-3-ultra-550b-a55b:free",
  "openrouter:anthropic/claude-sonnet-5",
  "openrouter:anthropic/claude-opus-4.8",
  "openrouter:anthropic/claude-fable-5",
  "openrouter:anthropic/claude-haiku-4.5",
  "openrouter:openai/gpt-5.5",
  "openrouter:openai/gpt-5.4",
  "openrouter:openai/gpt-5.4-mini",
  "openrouter:google/gemini-3.5-flash",
  "openrouter:google/gemini-3.1-pro-preview",
  "openrouter:google/gemini-3.1-flash-lite",
  "openrouter:x-ai/grok-4.3",
  "openrouter:deepseek/deepseek-v4-pro",
  "openrouter:deepseek/deepseek-v4-flash",
  "openrouter:z-ai/glm-5.2",
  "openrouter:z-ai/glm-5",
  "openrouter:moonshotai/kimi-k2.6",
  "openrouter:minimax/minimax-m3",
  "openrouter:minimax/minimax-m2.5",
  "openrouter:qwen/qwen3.7-max",
  "openrouter:qwen/qwen3-coder",
  "openrouter:meta-llama/llama-4-maverick",
  "openrouter:xiaomi/mimo-v2.5",
  "openrouter:inclusionai/ling-2.6-flash",
]

export function isModelVisibleInSelector(
  model: Pick<ModelConfig, "catalogStatus">
): boolean {
  return model.catalogStatus === "visible"
}

const NON_AUTH_ALLOWED_MODEL_IDS = new Set(
  NON_AUTH_ALLOWED_MODELS.map((modelId) => resolveModelId(modelId))
)

export function isModelAllowedForAnonymous(modelId: string): boolean {
  return NON_AUTH_ALLOWED_MODEL_IDS.has(resolveModelId(modelId))
}

export function isModelSelectableForAuthState(
  model: Pick<ModelConfig, "id" | "accessible">,
  isAuthenticated: boolean
): boolean {
  if (!isAuthenticated) {
    return isModelAllowedForAnonymous(model.id)
  }

  return model.accessible === true
}

/**
 * Utility function to filter and sort models based on favorites, search, and visibility
 * @param models - All available models
 * @param favoriteModels - Array of favorite model IDs
 * @param searchQuery - Search query to filter by model name
 * @param isModelHidden - Function to check if a model is hidden
 * @returns Filtered and sorted models
 */
export function filterAndSortModels(
  models: ModelConfig[],
  favoriteModels: string[],
  searchQuery: string,
  isModelHidden: (modelId: string) => boolean
): ModelConfig[] {
  const selectorModels = models.filter(
    (model) => isModelVisibleInSelector(model) && !isModelHidden(model.id)
  )
  const visibleFavoriteModels = favoriteModels.filter((favoriteModelId) =>
    selectorModels.some((model) => model.id === favoriteModelId)
  )
  const shouldRestrictToFavorites = visibleFavoriteModels.length > 0

  return selectorModels
    .filter((model) => {
      if (shouldRestrictToFavorites) {
        return visibleFavoriteModels.includes(model.id)
      }
      return true
    })
    .filter((model) =>
      model.name.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => {
      if (shouldRestrictToFavorites) {
        const aIndex = visibleFavoriteModels.indexOf(a.id)
        const bIndex = visibleFavoriteModels.indexOf(b.id)
        return aIndex - bIndex
      }

      const aOrder = DEFAULT_MODEL_ORDER.indexOf(a.id)
      const bOrder = DEFAULT_MODEL_ORDER.indexOf(b.id)
      const aInList = aOrder !== -1
      const bInList = bOrder !== -1

      if (aInList && bInList) return aOrder - bOrder
      if (aInList) return -1
      if (bInList) return 1
      return 0 // preserve original array-declaration order
    })
}

type ResolvePreferredModelIdOptions = {
  models: ModelConfig[]
  isAuthenticated: boolean
  currentModelId?: string | null
  preferredModelIds?: Array<string | null | undefined>
}

export function resolvePreferredModelId({
  models,
  isAuthenticated,
  currentModelId,
  preferredModelIds = [],
}: ResolvePreferredModelIdOptions): string {
  const selectableVisibleModelIds = new Set(
    models
      .filter(
        (model) =>
          isModelSelectableForAuthState(model, isAuthenticated) &&
          isModelVisibleInSelector(model)
      )
      .map((model) => model.id)
  )

  const normalizeVisibleModelId = (
    modelId: string | null | undefined
  ): string | null => {
    if (!modelId) return null
    const resolvedModelId = resolveModelId(modelId)
    return models.some((model) => model.id === resolvedModelId)
      ? resolvedModelId
      : null
  }

  const normalizeRoutableModelId = (
    modelId: string | null | undefined
  ): string | null => {
    if (!modelId) return null
    const resolvedModelId = resolveModelId(modelId)
    return getModelInfo(resolvedModelId) ? resolvedModelId : null
  }

  const normalizedCurrentModelId = normalizeRoutableModelId(currentModelId)
  if (normalizedCurrentModelId) {
    if (
      isAuthenticated ||
      isModelAllowedForAnonymous(normalizedCurrentModelId)
    ) {
      return normalizedCurrentModelId
    }
  }

  for (const preferredModelId of preferredModelIds) {
    const normalizedPreferredModelId = normalizeVisibleModelId(preferredModelId)
    if (
      normalizedPreferredModelId &&
      selectableVisibleModelIds.has(normalizedPreferredModelId)
    ) {
      return normalizedPreferredModelId
    }
  }

  const defaultModelId = normalizeVisibleModelId(
    getDefaultModelForUser(isAuthenticated)
  )
  if (defaultModelId && selectableVisibleModelIds.has(defaultModelId)) {
    return defaultModelId
  }

  const firstSelectableVisibleModelId = models.find(
    (model) =>
      isModelSelectableForAuthState(model, isAuthenticated) &&
      isModelVisibleInSelector(model)
  )?.id
  if (firstSelectableVisibleModelId) return firstSelectableVisibleModelId

  if (isAuthenticated) {
    const firstVisibleModelId = models.find(isModelVisibleInSelector)?.id
    if (firstVisibleModelId) return firstVisibleModelId
  }

  const defaultRoutableModelId = resolveModelId(
    getDefaultModelForUser(isAuthenticated)
  )
  if (isAuthenticated || isModelAllowedForAnonymous(defaultRoutableModelId)) {
    return defaultRoutableModelId
  }

  if (defaultModelId) return defaultModelId
  return (
    models[0]?.id ?? resolveModelId(getDefaultModelForUser(isAuthenticated))
  )
}
