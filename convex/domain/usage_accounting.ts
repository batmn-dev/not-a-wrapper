/**
 * Platform allowance accounting math (ADR-0021) — pure, integer-only, shared
 * by the Convex allowance module (reserve/settle/release) and the Next-side
 * estimator. No floats cross this module's outputs: rates are integer credits
 * (micro-USD) per one million tokens, and every cost component rounds ONCE
 * with `ceil` (never per token) so fractional micro-USD never silently
 * rounds platform cost to zero.
 */

export const TOKENS_PER_RATE_UNIT = 1_000_000

/**
 * One route's billable rates, pinned at reservation time. `revision` names
 * the pricing generation the rates were compiled from; a catalog change after
 * reservation never re-prices an in-flight request.
 */
export type RoutePricingRate = {
  modelId: string
  routeId: string
  providerId: string
  upstreamModelId: string
  /** Integer credits (micro-USD) per 1M input tokens. */
  inputCreditsPerMTok: number
  /** Integer credits (micro-USD) per 1M output tokens. */
  outputCreditsPerMTok: number
}

export type PricingSnapshot = {
  revision: string
  currency: "USD"
  /** The answer route's rates. */
  primary: RoutePricingRate
  /** The title-generation route's rates, when a title call may run. */
  title?: RoutePricingRate
}

export type UsageTokens = {
  inputTokens?: number
  outputTokens?: number
}

/** A component cost: ceil((tokens × ratePerMTok) / 1M), rounded ONCE. */
export function creditsForTokens(
  tokens: number | undefined,
  creditsPerMTok: number
): number {
  const count = normalizeTokenCount(tokens)
  if (count === 0 || creditsPerMTok === 0) return 0
  return Math.ceil((count * creditsPerMTok) / TOKENS_PER_RATE_UNIT)
}

function normalizeTokenCount(tokens: number | undefined): number {
  if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens <= 0) {
    return 0
  }
  return Math.floor(tokens)
}

/** Cost of one generation's usage at one route's rates (two components). */
export function computeUsageCredits(
  rate: Pick<RoutePricingRate, "inputCreditsPerMTok" | "outputCreditsPerMTok">,
  usage: UsageTokens
): number {
  return (
    creditsForTokens(usage.inputTokens, rate.inputCreditsPerMTok) +
    creditsForTokens(usage.outputTokens, rate.outputCreditsPerMTok)
  )
}

/**
 * How the settled cost was derived — persisted on the reservation so an
 * estimate-based charge is never presented as exact billing.
 */
export type SettlementBasis =
  /** Provider-reported aggregate usage; title usage (if any) also observed. */
  | "actual"
  /** Aggregate usage observed, but the title call's usage never arrived —
   * the title component is charged at its reservation-time estimate. */
  | "actual_with_estimated_title"
  /** Terminal without an onEnd aggregate; settled from per-step accumulated
   * usage evidence (abort/failure mid-stream). */
  | "observed_partial"
  /** Provider work started but no usage evidence survived; the reserved
   * estimate is charged rather than silently refunded. */
  | "estimated_after_unknown_usage"

export type BucketBalances = {
  grantedCredits: number
  availableCredits: number
  reservedCredits: number
  spentCredits: number
}

/** The materialized-balance invariant every mutation must preserve. */
export function bucketInvariantHolds(bucket: BucketBalances): boolean {
  return (
    bucket.availableCredits ===
    bucket.grantedCredits - bucket.spentCredits - bucket.reservedCredits
  )
}

export function applyReserve(
  bucket: BucketBalances,
  estimatedCredits: number
): BucketBalances {
  return {
    ...bucket,
    availableCredits: bucket.availableCredits - estimatedCredits,
    reservedCredits: bucket.reservedCredits + estimatedCredits,
  }
}

/**
 * Settle reservation R at actual cost A: available += R − A, reserved −= R,
 * spent += A. May drive `availableCredits` negative — an overrun is recorded,
 * never clamped; the negative balance blocks later reservations until the
 * next period's grant.
 */
export function applySettle(
  bucket: BucketBalances,
  reservedCredits: number,
  actualCredits: number
): BucketBalances {
  return {
    ...bucket,
    availableCredits:
      bucket.availableCredits + reservedCredits - actualCredits,
    reservedCredits: bucket.reservedCredits - reservedCredits,
    spentCredits: bucket.spentCredits + actualCredits,
  }
}

/** Release reservation R untouched: provider consumption never began. */
export function applyRelease(
  bucket: BucketBalances,
  reservedCredits: number
): BucketBalances {
  return {
    ...bucket,
    availableCredits: bucket.availableCredits + reservedCredits,
    reservedCredits: bucket.reservedCredits - reservedCredits,
  }
}

// Ledger event keys — deterministic idempotency identities (ADR-0021).
// Uniqueness is enforced by an indexed read inside the inserting mutation.

export function grantEventKey(userId: string, periodKey: string): string {
  return `grant:${userId}:${periodKey}`
}

export function reserveEventKey(reservationId: string): string {
  return `reserve:${reservationId}`
}

export function settleEventKey(reservationId: string): string {
  return `settle:${reservationId}`
}

export function releaseEventKey(reservationId: string): string {
  return `release:${reservationId}`
}

/**
 * The reservation's payload fingerprint: detects a reused request id whose
 * payload changed (typed conflict) versus an identical replay (idempotent).
 * Deterministic over the facts that make two reservation attempts "the same
 * request" — INCLUDING the snapshot's integer rates, so a replay carrying the
 * same revision string but different rates (a forged cheaper snapshot) can
 * never pass as identical. Deliberately excludes volatile fields like
 * timestamps.
 */
export function reservationPayloadFingerprint(args: {
  modelId: string
  routeId: string
  providerId: string
  estimatedCredits: number
  pricingSnapshot: PricingSnapshot
}): string {
  const { primary, title, revision } = args.pricingSnapshot
  return [
    "v2",
    args.modelId,
    args.routeId,
    args.providerId,
    String(args.estimatedCredits),
    revision,
    String(primary.inputCreditsPerMTok),
    String(primary.outputCreditsPerMTok),
    title ? String(title.inputCreditsPerMTok) : "-",
    title ? String(title.outputCreditsPerMTok) : "-",
  ].join("|")
}

/** Validate an integer credit amount crossing a trust boundary. */
export function isValidCreditAmount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  )
}

/** Validate a pricing snapshot crossing a trust boundary (shape + integers). */
export function isValidPricingSnapshot(
  snapshot: PricingSnapshot
): boolean {
  const rateValid = (rate: RoutePricingRate) =>
    isValidCreditAmount(rate.inputCreditsPerMTok) &&
    isValidCreditAmount(rate.outputCreditsPerMTok) &&
    rate.modelId.length > 0 &&
    rate.routeId.length > 0 &&
    rate.providerId.length > 0
  return (
    snapshot.currency === "USD" &&
    snapshot.revision.length > 0 &&
    rateValid(snapshot.primary) &&
    (snapshot.title === undefined || rateValid(snapshot.title))
  )
}
