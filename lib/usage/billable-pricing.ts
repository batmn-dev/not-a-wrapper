import type {
  PricingSnapshot,
  RoutePricingRate,
} from "@/convex/domain/usage_accounting"
import { selectChatTitleModelConfig } from "@/lib/chat-title"
import { ROUTE_CONFIGS, toUpstreamModelId, type ModelRoute } from "@/lib/models/catalog"
import type { ModelConfig } from "@/lib/models/types"

/**
 * Billable route pricing (ADR-0021): compile the catalog's numeric USD-per-1M
 * `inputCost`/`outputCost` into typed integer rates (credits = micro-USD per
 * 1M tokens) ONCE, at snapshot-build time. The human-readable `priceUnit`
 * string is display-only and never parsed. Platform funding fails closed: a
 * route without valid numeric pricing gets no snapshot and therefore no
 * reservation. An explicitly free route ($0.00) is a valid zero-rate snapshot.
 */

/** Names the pricing generation a snapshot was compiled from. Bump when the
 * rate derivation or the catalog pricing data changes materially. */
export const PLATFORM_PRICING_REVISION = "catalog-2026-08-19"

const USD_TO_CREDITS = 1_000_000

function toCreditsPerMTok(usdPerMTok: number | undefined): number | null {
  if (
    typeof usdPerMTok !== "number" ||
    !Number.isFinite(usdPerMTok) ||
    usdPerMTok < 0
  ) {
    return null
  }
  return Math.round(usdPerMTok * USD_TO_CREDITS)
}

/** Integer rates for one route, or null when the route is not billable. */
export function buildRoutePricingRate(
  config: ModelConfig,
  modelId: string
): RoutePricingRate | null {
  const inputCreditsPerMTok = toCreditsPerMTok(config.inputCost)
  const outputCreditsPerMTok = toCreditsPerMTok(config.outputCost)
  if (inputCreditsPerMTok === null || outputCreditsPerMTok === null) {
    return null
  }
  return {
    modelId,
    routeId: config.id,
    providerId: config.providerId,
    upstreamModelId: toUpstreamModelId(config.id),
    inputCreditsPerMTok,
    outputCreditsPerMTok,
  }
}

/**
 * The complete pricing snapshot for one platform-funded request: the answer
 * route's rates plus the title route's own rates (title generation reuses the
 * resolved credential on a small same-provider model — priced at ITS rates,
 * never the answer model's). Null → the route is not platform-fundable.
 */
export function buildPricingSnapshot(route: ModelRoute): PricingSnapshot | null {
  const primary = buildRoutePricingRate(route.config, route.modelId)
  if (!primary) return null

  const titleConfig = selectChatTitleModelConfig(ROUTE_CONFIGS, route.config)
  const title = buildRoutePricingRate(titleConfig, titleConfig.id)
  // The title call runs on the same credential; an unpriced title route must
  // fail platform funding closed just like an unpriced answer route.
  if (!title) return null

  return {
    revision: PLATFORM_PRICING_REVISION,
    currency: "USD",
    primary,
    title,
  }
}
