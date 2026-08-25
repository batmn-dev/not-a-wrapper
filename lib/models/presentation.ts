import { MODEL_PROVIDER_IDENTITY, type Provider } from "@/lib/provider-identity"
import type { ModelConfig } from "./types"

export type ModelPresentationSource = Pick<
  ModelConfig,
  "baseProviderId" | "icon"
>

type ModelDisplayNameSource = Pick<ModelConfig, "name" | "shortName">
type ModelSnapshotDateSource = Pick<ModelConfig, "snapshotDate">

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

const snapshotDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
})

/** Format explicit snapshot metadata without deriving dates from model names. */
export function getModelSnapshotDateLabel(
  model: ModelSnapshotDateSource
): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(model.snapshotDate ?? "")
  if (!match) return undefined

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const timestamp = Date.UTC(year, month - 1, day)
  const parsed = new Date(timestamp)
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return undefined
  }

  return snapshotDateFormatter.format(parsed)
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
