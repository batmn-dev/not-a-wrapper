import type { ModelConfig } from "./types"

type SortableModel = Pick<
  ModelConfig,
  "name" | "releasedAt" | "intelligence" | "inputCost" | "outputCost"
>

const INTELLIGENCE_RANK: Record<
  NonNullable<ModelConfig["intelligence"]>,
  number
> = {
  High: 3,
  Medium: 2,
  Low: 1,
}

const PROVIDER_SECTION_PRIORITY = [
  "anthropic",
  "openai",
  "xai",
  "google",
  "perplexity",
] as const

const PROVIDER_SECTION_RANK = new Map<string, number>(
  PROVIDER_SECTION_PRIORITY.map((providerId, index) => [providerId, index])
)

function releaseTimestamp(releasedAt: string | undefined): number {
  if (!releasedAt) return Number.NEGATIVE_INFINITY

  const timestamp = Date.parse(releasedAt)
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp
}

function combinedTokenPrice(model: SortableModel): number {
  return (model.inputCost ?? 0) + (model.outputCost ?? 0)
}

function intelligenceRank(intelligence: ModelConfig["intelligence"]): number {
  return intelligence ? INTELLIGENCE_RANK[intelligence] : 0
}

/**
 * Keeps the primary providers in the product-defined order. Returning zero for
 * two unranked providers preserves their existing catalog order via stable sort.
 */
export function compareProviderSections(a: string, b: string): number {
  const aRank = PROVIDER_SECTION_RANK.get(a)
  const bRank = PROVIDER_SECTION_RANK.get(b)

  if (aRank !== undefined && bRank !== undefined) return aRank - bRank
  if (aRank !== undefined) return -1
  if (bRank !== undefined) return 1
  return 0
}

/**
 * Provider-section order: newest release first, then stronger intelligence,
 * then higher combined input/output price as the capability-tier proxy the
 * catalog exposes. Name is the deterministic final tie-break. Models without
 * a valid release date sort after dated models.
 */
export function compareModelsForProviderSection(
  a: SortableModel,
  b: SortableModel
): number {
  const aReleasedAt = releaseTimestamp(a.releasedAt)
  const bReleasedAt = releaseTimestamp(b.releasedAt)
  if (aReleasedAt !== bReleasedAt) return bReleasedAt - aReleasedAt

  const intelligenceDifference =
    intelligenceRank(b.intelligence) - intelligenceRank(a.intelligence)
  if (intelligenceDifference !== 0) return intelligenceDifference

  const priceDifference = combinedTokenPrice(b) - combinedTokenPrice(a)
  if (priceDifference !== 0) return priceDifference

  return a.name.localeCompare(b.name)
}
