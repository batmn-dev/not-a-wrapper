import { v } from "convex/values"

/**
 * Shared validators for the platform-allowance tables and mutation args
 * (ADR-0021). One declaration serves the schema and the reserve mutation so
 * the stored shape and the wire shape can never drift.
 */

export const vRoutePricingRate = v.object({
  modelId: v.string(),
  routeId: v.string(),
  providerId: v.string(),
  upstreamModelId: v.string(),
  inputCreditsPerMTok: v.number(),
  outputCreditsPerMTok: v.number(),
})

export const vPricingSnapshot = v.object({
  revision: v.string(),
  currency: v.literal("USD"),
  primary: vRoutePricingRate,
  title: v.optional(vRoutePricingRate),
})

export const vUsageReservationStatus = v.union(
  v.literal("reserved"),
  v.literal("settled"),
  v.literal("released")
)

export const vSettlementBasis = v.union(
  v.literal("actual"),
  v.literal("actual_with_estimated_title"),
  v.literal("observed_partial"),
  v.literal("estimated_after_unknown_usage")
)

export const vLedgerEntryType = v.union(
  v.literal("grant"),
  v.literal("reserve"),
  v.literal("settle"),
  v.literal("release"),
  v.literal("adjustment")
)
