import { getDefaultModelForUser, NON_AUTH_ALLOWED_MODELS } from "@/lib/config"
import { getModelInfo } from "@/lib/models"
import { resolveModelSelection } from "@/lib/models/catalog"
import { getModelDisplayName } from "@/lib/models/presentation"
import { getOrderedModelSections } from "@/lib/models/sort"
import type { ModelConfig } from "@/lib/models/types"

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
  /** Every other visible model in shared display order, optionally promoted. */
  others: M[]
}

/**
 * Group the visible catalog for the selector. Favorites RANK models in the
 * user's order. The remaining models use the shared canonical order; a
 * surface may additionally promote one model (the chat composer uses this for
 * its current selection). Search always covers the whole logical catalog.
 * Only explicit user-hidden models are excluded.
 */
export function groupModelsForSelector<M extends ModelConfig>(
  models: M[],
  favoriteModels: string[],
  promotedModelId: string | null,
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
  const orderedOthers = getOrderedModelSections(
    selectorModels.filter((model) => !favoriteRank.has(model.id))
  ).flatMap(({ models: sectionModels }) => sectionModels)
  const promotedIndex = promotedModelId
    ? orderedOthers.findIndex((model) => model.id === promotedModelId)
    : -1
  const others =
    promotedIndex > 0
      ? [
          orderedOthers[promotedIndex]!,
          ...orderedOthers.slice(0, promotedIndex),
          ...orderedOthers.slice(promotedIndex + 1),
        ]
      : orderedOthers

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
