import type { Infer } from "convex/values"
import type {
  vPricingSnapshot,
  vPrimaryTerminalUsageEvidence,
  vRoutePricingRate,
  vTerminalUsageEvidence,
  vTitleSettlementBasis,
  vTitleTerminalUsageEvidence,
  vUsageReservationArgs,
} from "../lib/usageValidators"

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
export type RoutePricingRate = Infer<typeof vRoutePricingRate>

export type PricingSnapshot = Infer<typeof vPricingSnapshot>

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
  /** LEGACY: provider work started but no usage evidence survived; the full
   * reserved estimate was charged. Historical rows remain readable, but new
   * user_stop/superseded settlements never write it (cancellation
   * amendment) — they use the two bases below instead. */
  | "estimated_after_unknown_usage"
  /** Cancellation with no completed step and no persisted output: only the
   * estimated input is charged. */
  | "estimated_input_floor"
  /** Cancellation with persisted partial assistant output: estimated input
   * plus a bounded estimate of the partial output. */
  | "estimated_input_with_partial_output"

export type TitleSettlementBasis = Infer<typeof vTitleSettlementBasis>

// Cancellation terminal-usage evidence (ADR-0021 amendment): the normalized
// domain shapes both the live worker receipt and the deadline reconciler
// settle through. One decision tree — never two billing paths.
export type PrimaryTerminalUsageEvidence = Infer<
  typeof vPrimaryTerminalUsageEvidence
>
export type TitleTerminalUsageEvidence = Infer<
  typeof vTitleTerminalUsageEvidence
>
export type TerminalUsageEvidencePayload = Infer<typeof vTerminalUsageEvidence>

/** Reservation facts the terminal settlement decision prices against. */
export type TerminalReservationFacts = {
  reservedCredits: number
  estimatedInputTokens?: number
  estimatedOutputTokens?: number
  titleEstimatedCredits?: number
  titleEstimatedInputTokens?: number
  pricingSnapshot: PricingSnapshot
}

export type TerminalSettlementDecision =
  | { kind: "release" }
  | {
      kind: "settle"
      actualCredits: number
      basis: SettlementBasis
      titleCredits: number
      titleBasis: TitleSettlementBasis
      inputTokens?: number
      outputTokens?: number
      /** Present when the reservation cap clamped a fallback total. */
      uncappedCredits?: number
      /** Evidence named a route the pinned snapshot does not know. */
      titleRouteUnrecognized: boolean
    }

/** Reject malformed or negative token counts before any pricing math. */
export function isValidTerminalUsageEvidence(
  evidence: TerminalUsageEvidencePayload
): boolean {
  const { primary, title } = evidence
  const primaryValid =
    primary.kind === "not-started" ||
    (primary.kind === "actual"
      ? isValidTokenEstimate(primary.inputTokens) &&
        isValidTokenEstimate(primary.outputTokens)
      : primary.kind === "completed-steps"
        ? isValidTokenEstimate(primary.inputTokens) &&
          isValidTokenEstimate(primary.outputTokens) &&
          isValidTokenEstimate(primary.partialOutputTokens)
        : isValidTokenEstimate(primary.partialOutputTokens))
  const titleValid =
    title.kind !== "actual" ||
    (isValidTokenEstimate(title.inputTokens) &&
      isValidTokenEstimate(title.outputTokens))
  return primaryValid && titleValid
}

/**
 * The ONE cancellation-settlement decision (ADR-0021 amendment §9): maps a
 * reservation's pinned facts plus normalized terminal evidence to a settle or
 * release. Deterministic evidence order — authoritative usage beats
 * estimates, estimates are never added on top of the observed component they
 * approximate, and locally estimated fallbacks are capped by the reservation
 * while provider-reported usage may honestly exceed it.
 */
export function resolveTerminalUsageSettlement(
  reservation: TerminalReservationFacts,
  evidence: TerminalUsageEvidencePayload
): TerminalSettlementDecision {
  const snapshot = reservation.pricingSnapshot
  const pinnedTitleRate = snapshot.title ?? snapshot.primary

  // --- Title component: independent basis, priced only at pinned rates.
  const title = evidence.title
  let titleCredits = 0
  let titleBasis: TitleSettlementBasis = "not_run"
  let titleRouteUnrecognized = false
  const titleFloorCredits = (rate: RoutePricingRate): number => {
    const floor =
      reservation.titleEstimatedInputTokens !== undefined
        ? computeUsageCredits(rate, {
            inputTokens: reservation.titleEstimatedInputTokens,
          })
        : (reservation.titleEstimatedCredits ?? 0)
    return reservation.titleEstimatedCredits !== undefined
      ? Math.min(floor, reservation.titleEstimatedCredits)
      : floor
  }
  if (title.kind !== "not-run") {
    const claimedRate =
      title.pricingRole === "primary" ? snapshot.primary : pinnedTitleRate
    const routeMatches =
      title.routeId === undefined || claimedRate.routeId === title.routeId
    titleRouteUnrecognized = !routeMatches
    const rate = routeMatches ? claimedRate : pinnedTitleRate
    if (
      title.kind === "actual" &&
      routeMatches &&
      (typeof title.inputTokens === "number" ||
        typeof title.outputTokens === "number")
    ) {
      titleCredits = computeUsageCredits(rate, {
        inputTokens: title.inputTokens,
        outputTokens: title.outputTokens,
      })
      titleBasis = "actual"
    } else {
      titleCredits = titleFloorCredits(rate)
      titleBasis = "input_floor"
    }
  }

  // --- Primary component.
  const cappedPartial = (partialOutputTokens: number | undefined): number => {
    const partial = normalizeTokenCount(partialOutputTokens)
    return reservation.estimatedOutputTokens !== undefined
      ? Math.min(partial, reservation.estimatedOutputTokens)
      : partial
  }

  let basis: SettlementBasis
  let primaryCredits = 0
  let inputTokens: number | undefined
  let outputTokens: number | undefined
  let estimateBased = false
  switch (evidence.primary.kind) {
    case "not-started": {
      // Provider work never began. Release outright unless a title attempt
      // still needs charging, in which case only the title settles.
      if (title.kind === "not-run") return { kind: "release" }
      basis = "estimated_input_floor"
      estimateBased = true
      break
    }
    case "actual": {
      inputTokens = evidence.primary.inputTokens
      outputTokens = evidence.primary.outputTokens
      primaryCredits = computeUsageCredits(snapshot.primary, {
        inputTokens,
        outputTokens,
      })
      basis = "actual"
      break
    }
    case "completed-steps": {
      // The partial estimate covers ALL persisted output, completed steps
      // included — max(), never sum, so the two are not double-counted.
      inputTokens = normalizeTokenCount(evidence.primary.inputTokens)
      outputTokens = Math.max(
        normalizeTokenCount(evidence.primary.outputTokens),
        cappedPartial(evidence.primary.partialOutputTokens)
      )
      primaryCredits = computeUsageCredits(snapshot.primary, {
        inputTokens,
        outputTokens,
      })
      basis = "observed_partial"
      break
    }
    case "started-without-usage": {
      inputTokens = reservation.estimatedInputTokens ?? 0
      outputTokens = cappedPartial(evidence.primary.partialOutputTokens)
      primaryCredits = computeUsageCredits(snapshot.primary, {
        inputTokens,
        outputTokens,
      })
      basis =
        outputTokens > 0
          ? "estimated_input_with_partial_output"
          : "estimated_input_floor"
      estimateBased = true
      break
    }
  }

  // The reservation caps ESTIMATED cost only (invariant 6): provider-reported
  // actual usage — a title attempt's included — may honestly exceed it, so an
  // actual title component rides on top of the capped estimate instead of
  // being swallowed by it.
  let actualCredits = primaryCredits + titleCredits
  let uncappedCredits: number | undefined
  if (estimateBased) {
    const actualTitleCredits = titleBasis === "actual" ? titleCredits : 0
    const estimatedCredits = actualCredits - actualTitleCredits
    if (estimatedCredits > reservation.reservedCredits) {
      uncappedCredits = actualCredits
      actualCredits = reservation.reservedCredits + actualTitleCredits
    }
  }
  return {
    kind: "settle",
    actualCredits,
    basis,
    titleCredits,
    titleBasis,
    inputTokens,
    outputTokens,
    ...(uncappedCredits !== undefined ? { uncappedCredits } : {}),
    titleRouteUnrecognized,
  }
}

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
    availableCredits: bucket.availableCredits + reservedCredits - actualCredits,
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
function pricingRateFingerprintValue(rate: RoutePricingRate) {
  const {
    modelId,
    routeId,
    providerId,
    upstreamModelId,
    inputCreditsPerMTok,
    outputCreditsPerMTok,
    ...unserialized
  } = rate
  unserialized satisfies Record<string, never>
  return [
    modelId,
    routeId,
    providerId,
    upstreamModelId,
    inputCreditsPerMTok,
    outputCreditsPerMTok,
  ] as const
}

function pricingSnapshotFingerprintValue(snapshot: PricingSnapshot) {
  const { revision, currency, primary, title, ...unserialized } = snapshot
  unserialized satisfies Record<string, never>
  return [
    revision,
    currency,
    pricingRateFingerprintValue(primary),
    title ? pricingRateFingerprintValue(title) : null,
  ] as const
}

export function reservationPayloadFingerprint(
  args: Infer<typeof vUsageReservationArgs>
): string {
  const {
    requestId: _requestId,
    chatId,
    modelId,
    routeId,
    providerId,
    estimatedCredits,
    estimatedInputTokens,
    estimatedOutputTokens,
    titleEstimatedCredits,
    titleEstimatedInputTokens,
    pricingSnapshot,
    ...unserialized
  } = args
  // requestId is the indexed idempotency key, not part of the payload compared
  // within that key. Every other mutable fact must be serialized.
  unserialized satisfies Record<string, never>

  const base = [
    chatId,
    modelId,
    routeId,
    providerId,
    estimatedCredits,
    estimatedInputTokens ?? null,
    estimatedOutputTokens ?? null,
    titleEstimatedCredits ?? null,
    pricingSnapshotFingerprintValue(pricingSnapshot),
  ] as const
  // Versioned expansion (rollout safety): a payload WITHOUT the title input
  // floor serializes byte-identically to the historical v3 shape, so
  // reservations created by the previous server build replay cleanly across
  // the deploy; payloads carrying it get the widened v4 shape.
  return JSON.stringify(
    titleEstimatedInputTokens === undefined
      ? ["usage-reservation-fingerprint-v3", ...base]
      : ["usage-reservation-fingerprint-v4", ...base, titleEstimatedInputTokens]
  )
}

/** Validate an integer credit amount crossing a trust boundary. */
export function isValidCreditAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

/** Validate a non-negative integer token estimate crossing a trust boundary. */
export function isValidTokenEstimate(
  value: unknown
): value is number | undefined {
  return (
    value === undefined ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
  )
}

/** Validate a pricing snapshot crossing a trust boundary (shape + integers). */
export function isValidPricingSnapshot(snapshot: PricingSnapshot): boolean {
  const rateValid = (rate: RoutePricingRate) =>
    isValidCreditAmount(rate.inputCreditsPerMTok) &&
    isValidCreditAmount(rate.outputCreditsPerMTok) &&
    rate.modelId.length > 0 &&
    rate.routeId.length > 0 &&
    rate.providerId.length > 0 &&
    rate.upstreamModelId.length > 0
  return (
    snapshot.currency === "USD" &&
    snapshot.revision.length > 0 &&
    rateValid(snapshot.primary) &&
    (snapshot.title === undefined || rateValid(snapshot.title))
  )
}

/** Validate every numeric reservation fact before hashing or persistence. */
export function isValidUsageReservationArgs(
  args: Infer<typeof vUsageReservationArgs>
): boolean {
  return (
    isValidCreditAmount(args.estimatedCredits) &&
    isValidTokenEstimate(args.estimatedInputTokens) &&
    isValidTokenEstimate(args.estimatedOutputTokens) &&
    (args.titleEstimatedCredits === undefined ||
      isValidCreditAmount(args.titleEstimatedCredits)) &&
    isValidTokenEstimate(args.titleEstimatedInputTokens) &&
    isValidPricingSnapshot(args.pricingSnapshot)
  )
}
