import { MODEL_PROVIDER_IDENTITY, type Provider } from "@/lib/provider-identity"
import type { ModelConfig } from "./types"

export type ModelPresentationSource = Pick<
  ModelConfig,
  "baseProviderId" | "icon"
>

type ModelDisplayNameSource = Pick<ModelConfig, "name" | "shortName">

type RouteProviderLabel = {
  providerId: Provider
  name: string
}

/** The model's explicit presentation identity wins over its vendor fallback. */
export function getModelPresentationVendorId(
  model: ModelPresentationSource
): string {
  return model.icon ?? model.baseProviderId
}

/** Select an explicit catalog-authored model name for the current surface. */
export function getModelDisplayName(
  model: ModelDisplayNameSource,
  variant: "full" | "compact" = "full"
): string {
  return variant === "compact" ? (model.shortName ?? model.name) : model.name
}

/**
 * Route-provider labels in canonical route order. The structured result lets
 * each route-detail surface choose its own grammar without re-deriving names.
 */
export function getRouteProviderLabels(
  routes: readonly { providerId: Provider }[]
): RouteProviderLabel[] {
  const labels: RouteProviderLabel[] = []
  const seen = new Set<Provider>()

  for (const route of routes) {
    if (seen.has(route.providerId)) continue
    seen.add(route.providerId)

    const provider = MODEL_PROVIDER_IDENTITY[route.providerId]
    labels.push({ providerId: provider.id, name: provider.name })
  }

  return labels
}
