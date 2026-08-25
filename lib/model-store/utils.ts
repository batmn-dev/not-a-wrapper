import { getDefaultModelForUser, NON_AUTH_ALLOWED_MODELS } from "@/lib/config"
import { getModelInfo } from "@/lib/models"
import { resolveModelSelection } from "@/lib/models/catalog"
import { openrouterModels } from "@/lib/models/data/openrouter"
import { getModelDisplayName } from "@/lib/models/presentation"
import type { ModelConfig } from "@/lib/models/types"

/**
 * Curated direct-provider model order for the model selector.
 * Models in this list appear first, in the exact order specified.
 */
const DIRECT_PROVIDER_DEFAULT_MODEL_ORDER: string[] = [
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
]

/**
 * Curated default model order for the selector. Direct-provider IDs are
 * curated above; the remaining order derives from the generated OpenRouter
 * catalog. Wrapped records use their logical model id (ADR-0020), so a model
 * added through OpenRouter still lands in the composer's curated order even
 * when its selector identity is a direct-provider model. Models not in this
 * list preserve their original array-declaration order.
 */
export const DEFAULT_MODEL_ORDER: string[] = Array.from(
  new Set([
    ...DIRECT_PROVIDER_DEFAULT_MODEL_ORDER,
    ...openrouterModels.map((model) => model.logicalModelId ?? model.id),
  ])
)

export function isModelVisibleInSelector(
  model: Pick<ModelConfig, "catalogStatus">
): boolean {
  return model.catalogStatus === "visible"
}

const NON_AUTH_ALLOWED_MODEL_IDS = new Set(
  NON_AUTH_ALLOWED_MODELS.map(
    (modelId) => resolveModelSelection(modelId).modelId
  )
)

export function isModelAllowedForAnonymous(modelId: string): boolean {
  return NON_AUTH_ALLOWED_MODEL_IDS.has(resolveModelSelection(modelId).modelId)
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

export type SelectorModelGroups<M extends ModelConfig = ModelConfig> = {
  /** The user's favorites, in the user's order. Ranking, not a filter. */
  favorites: M[]
  /** Every other visible model, selected first, then curated default order. */
  others: M[]
}

function byDefaultOrder(a: ModelConfig, b: ModelConfig): number {
  const aOrder = DEFAULT_MODEL_ORDER.indexOf(a.id)
  const bOrder = DEFAULT_MODEL_ORDER.indexOf(b.id)
  const aInList = aOrder !== -1
  const bInList = bOrder !== -1

  if (aInList && bInList) return aOrder - bOrder
  if (aInList) return -1
  if (bInList) return 1
  return 0 // preserve original array-declaration order
}

/**
 * Group the visible catalog for the selector. Favorites RANK models in the
 * user's order, while a selected non-favorite leads the All models group.
 * Search always covers the whole logical catalog. Only explicit user-hidden
 * models are excluded.
 */
export function groupModelsForSelector<M extends ModelConfig>(
  models: M[],
  favoriteModels: string[],
  selectedModelId: string | null,
  searchQuery: string,
  isModelHidden: (modelId: string) => boolean
): SelectorModelGroups<M> {
  const normalizedSearchQuery = searchQuery.toLowerCase()
  const selectorModels = models.filter(
    (model) =>
      isModelVisibleInSelector(model) &&
      !isModelHidden(model.id) &&
      [
        getModelDisplayName(model),
        getModelDisplayName(model, "compact"),
      ].some((name) => name.toLowerCase().includes(normalizedSearchQuery))
  )

  const favoriteRank = new Map(
    favoriteModels.map((modelId, index) => [modelId, index])
  )
  const favorites = selectorModels
    .filter((model) => favoriteRank.has(model.id))
    .sort(
      (a, b) => (favoriteRank.get(a.id) ?? 0) - (favoriteRank.get(b.id) ?? 0)
    )
  const others = selectorModels
    .filter((model) => !favoriteRank.has(model.id))
    .sort((a, b) => {
      if (a.id === selectedModelId) return -1
      if (b.id === selectedModelId) return 1
      return byDefaultOrder(a, b)
    })

  return { favorites, others }
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
    const resolvedModelId = resolveModelSelection(modelId).modelId
    return models.some((model) => model.id === resolvedModelId)
      ? resolvedModelId
      : null
  }

  const normalizeRoutableModelId = (
    modelId: string | null | undefined
  ): string | null => {
    if (!modelId) return null
    const selection = resolveModelSelection(modelId)
    return getModelInfo(selection.modelId)
      ? (selection.legacyRouteHint ?? selection.modelId)
      : null
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

  const defaultRoutableModelId = resolveModelSelection(
    getDefaultModelForUser(isAuthenticated)
  ).modelId
  if (isAuthenticated || isModelAllowedForAnonymous(defaultRoutableModelId)) {
    return defaultRoutableModelId
  }

  if (defaultModelId) return defaultModelId
  return (
    models[0]?.id ??
    resolveModelSelection(getDefaultModelForUser(isAuthenticated)).modelId
  )
}
