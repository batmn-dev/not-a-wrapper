import { v, type Infer } from "convex/values"

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

/**
 * The complete caller-controlled reservation payload. Keep this as the single
 * source for both Convex validation and TypeScript so adding a field also
 * widens the authorization payload and trips its exhaustive serializer.
 */
export const usageReservationArgValidators = {
  requestId: v.string(),
  chatId: v.string(),
  modelId: v.string(),
  routeId: v.string(),
  providerId: v.string(),
  estimatedCredits: v.number(),
  estimatedInputTokens: v.optional(v.number()),
  estimatedOutputTokens: v.optional(v.number()),
  titleEstimatedCredits: v.optional(v.number()),
  // Input-only title floor (cancellation settlement). Optional for the
  // Convex-first deployment window: fingerprint and authorization serialize
  // it only when present, so old-server payloads keep verifying.
  titleEstimatedInputTokens: v.optional(v.number()),
  pricingSnapshot: vPricingSnapshot,
}

export const vUsageReservationArgs = v.object(usageReservationArgValidators)

export type UsageReservationArgs = Infer<typeof vUsageReservationArgs>

export const vUsageReservationStatus = v.union(
  v.literal("reserved"),
  v.literal("settled"),
  v.literal("released")
)

export const vSettlementBasis = v.union(
  v.literal("actual"),
  v.literal("actual_with_estimated_title"),
  v.literal("observed_partial"),
  // Legacy literal: still readable on historical rows, but never written for
  // new user_stop/superseded settlements (cancellation amendment).
  v.literal("estimated_after_unknown_usage"),
  // Cancellation settlements (ADR-0021 amendment): estimated input only, or
  // estimated input plus a bounded estimate of persisted partial output.
  v.literal("estimated_input_floor"),
  v.literal("estimated_input_with_partial_output")
)

/** How the settled title component was derived (persisted separately from
 * the primary basis to avoid a combinatorial top-level enum). */
export const vTitleSettlementBasis = v.union(
  v.literal("actual"),
  v.literal("input_floor"),
  v.literal("not_run")
)

const vPricingRole = v.union(v.literal("title"), v.literal("primary"))

/**
 * Terminal usage evidence for cancellation settlement — the discriminated
 * shapes the worker's aborted terminal write and the settlement-only receipt
 * both carry. Missing numeric fields always mean "not observed"; the pure
 * settlement decision (convex/domain/usage_accounting.ts) owns their
 * interpretation.
 */
export const vPrimaryTerminalUsageEvidence = v.union(
  v.object({ kind: v.literal("not-started") }),
  v.object({
    kind: v.literal("actual"),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
  }),
  v.object({
    kind: v.literal("completed-steps"),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    partialOutputTokens: v.optional(v.number()),
  }),
  v.object({
    kind: v.literal("started-without-usage"),
    partialOutputTokens: v.optional(v.number()),
  })
)

export const vTitleTerminalUsageEvidence = v.union(
  v.object({ kind: v.literal("not-run") }),
  v.object({
    kind: v.literal("actual"),
    routeId: v.string(),
    pricingRole: vPricingRole,
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
  }),
  v.object({
    kind: v.literal("started-without-usage"),
    // Route identity is optional: the deadline reconciler cannot know which
    // route a vanished worker attempted; the pinned title rate then prices
    // the floor.
    routeId: v.optional(v.string()),
    pricingRole: v.optional(vPricingRole),
  })
)

export const vTerminalUsageEvidence = v.object({
  primary: vPrimaryTerminalUsageEvidence,
  title: vTitleTerminalUsageEvidence,
})

export const vLedgerEntryType = v.union(
  v.literal("grant"),
  v.literal("reserve"),
  v.literal("settle"),
  v.literal("release"),
  v.literal("adjustment")
)
