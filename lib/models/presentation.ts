import { MODEL_PROVIDER_IDENTITY, type Provider } from "@/lib/provider-identity"
import type { ModelConfig } from "./types"

export type ModelPresentationSource = Pick<
  ModelConfig,
  "baseProviderId" | "icon"
>

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
