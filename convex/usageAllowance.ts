import { v } from "convex/values"
import { CHAT_TURN_EXECUTION_BUDGET } from "../lib/chat-turn/execution-budget"
import { estimatePartialOutputTokens } from "../lib/usage/terminal-usage-estimate"
import type { Doc, Id } from "./_generated/dataModel"
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server"
import type { GenerationRunTerminalReason } from "./domain/generation_run_lifecycle"
import {
  applyRelease,
  applyReserve,
  applySettle,
  bucketInvariantHolds,
  computeUsageCredits,
  grantEventKey,
  isValidUsageReservationArgs,
  releaseEventKey,
  reservationPayloadFingerprint,
  reserveEventKey,
  resolveTerminalUsageSettlement,
  settleEventKey,
  type PricingSnapshot,
  type SettlementBasis,
  type TerminalReservationFacts,
  type TerminalSettlementDecision,
  type TerminalUsageEvidencePayload,
  type UsageTokens,
} from "./domain/usage_accounting"
import {
  currentPlanPeriod,
  resolvePlanPolicy,
} from "./domain/usage_plan_policy"
import {
  authenticatedMutation,
  authenticatedQuery,
} from "./lib/authedFunctions"
import {
  usageReservationAuthorizationAudience,
  verifyUsageReservationAuthorization,
} from "./lib/usageReservationAuthorization"
import {
  usageReservationArgValidators,
  type UsageReservationArgs,
} from "./lib/usageValidators"
import { evaluateFixedWindow } from "./rateLimits"

/**
 * Platform usage allowance (ADR-0021): atomic reserve-and-settle accounting
 * over one included bucket per user per plan period. The bucket is the
 * materialized fast read model; every balance change appends a ledger entry
 * with a deterministic idempotency key. All operations run inside single
 * Convex mutations — there is deliberately NO check-balance query feeding a
 * later debit (the TOCTOU race this module exists to remove).
 */

// A reservation older than this that is still "reserved" is a strand: the
// route budget is 300s and settlement retries are bounded, so nothing
// legitimate holds a reservation this long. The reconciler applies the
// provider-boundary rule; it never blindly releases attached reservations.
export const STALE_RESERVATION_MS = 30 * 60 * 1000

/**
 * Cancellation-evidence window (ADR-0021 cancellation amendment): how long a
 * Stop/supersession keeps its reservation held awaiting the stopped worker's
 * terminal-usage receipt. Derived from the execution budget's settlement
 * reserve (the worker's terminal writes fit inside it) plus one deadline
 * reconciler interval of slack — the settlement-only grant expires at the
 * same deadline, so the worker stays authorized for the whole window.
 */
export const TERMINAL_EVIDENCE_WINDOW_MS =
  CHAT_TURN_EXECUTION_BUDGET.settlementReserveMs + 15_000

function warnUsage(tag: string, fields: Record<string, unknown>): void {
  console.warn(JSON.stringify({ _tag: tag, ...fields }))
}

function logUsage(tag: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ _tag: tag, ...fields }))
}

/**
 * Resolve (or lazily materialize) the caller's current-period included
 * bucket. Idempotent: the indexed read inside this transaction is the
 * uniqueness guard, and the grant ledger entry carries the deterministic
 * grant:{user}:{period} key.
 */
export async function ensureCurrentUsageBucket(
  ctx: MutationCtx,
  user: Doc<"users">,
  now: number
): Promise<Doc<"usageBuckets">> {
  const period = currentPlanPeriod(now)
  const existing = await ctx.db
    .query("usageBuckets")
    .withIndex("by_user_kind_period", (q) =>
      q
        .eq("userId", user._id)
        .eq("bucketKind", "included")
        .eq("periodKey", period.periodKey)
    )
    .unique()
  if (existing) return existing

  const plan = resolvePlanPolicy(user)
  const bucketId = await ctx.db.insert("usageBuckets", {
    userId: user._id,
    bucketKind: "included",
    periodKey: period.periodKey,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    planId: plan.planId,
    grantedCredits: plan.includedCreditsPerPeriod,
    availableCredits: plan.includedCreditsPerPeriod,
    reservedCredits: 0,
    spentCredits: 0,
    status: "active",
    createdAt: now,
    updatedAt: now,
  })
  await insertLedgerEntry(ctx, {
    userId: user._id,
    bucketId,
    eventKey: grantEventKey(user._id, period.periodKey),
    type: "grant",
    deltaAvailableCredits: plan.includedCreditsPerPeriod,
    deltaReservedCredits: 0,
    deltaSpentCredits: 0,
    revision: plan.planId,
    createdAt: now,
  })
  const bucket = await ctx.db.get(bucketId)
  if (!bucket) throw new Error("Usage bucket vanished after insert")
  return bucket
}

/**
 * Append one ledger entry, enforcing event-key uniqueness inside the same
 * transaction. Returns false (and warns) when the key already exists —
 * callers treat that as "this event already happened".
 */
async function insertLedgerEntry(
  ctx: MutationCtx,
  entry: Omit<Doc<"usageLedgerEntries">, "_id" | "_creationTime">
): Promise<boolean> {
  const existing = await ctx.db
    .query("usageLedgerEntries")
    .withIndex("by_event_key", (q) => q.eq("eventKey", entry.eventKey))
    .first()
  if (existing) {
    warnUsage("usage_ledger_event_duplicate", { eventKey: entry.eventKey })
    return false
  }
  await ctx.db.insert("usageLedgerEntries", entry)
  return true
}

async function patchBucketBalances(
  ctx: MutationCtx,
  bucket: Doc<"usageBuckets">,
  next: {
    availableCredits: number
    reservedCredits: number
    spentCredits: number
  },
  now: number
): Promise<void> {
  const patched = { ...bucket, ...next }
  if (!bucketInvariantHolds(patched)) {
    // A violated invariant is corruption, not a user error — refuse to
    // commit it and let the transaction roll back for repair via ledger.
    warnUsage("usage_bucket_invariant_violation", {
      bucketId: bucket._id,
      granted: patched.grantedCredits,
      available: patched.availableCredits,
      reserved: patched.reservedCredits,
      spent: patched.spentCredits,
    })
    throw new Error("Usage bucket invariant violation")
  }
  await ctx.db.patch(bucket._id, { ...next, updatedAt: now })
}

// Defense-in-depth reserve throttle: fixed-window per user, reusing the shared
// apiRateLimits table + pure window arithmetic. The signed authorization below
// is the authority boundary; this limits abuse through the legitimate server
// route or damage from a future signer regression.
const RESERVE_RATE_LIMIT = { limit: 30, windowMs: 60_000 }
const RESERVE_RATE_BUCKET = "usage_reserve"

async function consumeReserveRateLimit(
  ctx: MutationCtx,
  userId: Id<"users">,
  now: number
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const actorKey = `user:${userId}`
  const buckets = await ctx.db
    .query("apiRateLimits")
    .withIndex("by_actor_bucket_window", (q) =>
      q.eq("actorKey", actorKey).eq("bucket", RESERVE_RATE_BUCKET)
    )
    .collect()
  const decision = evaluateFixedWindow(buckets, {
    now,
    limit: RESERVE_RATE_LIMIT.limit,
    windowMs: RESERVE_RATE_LIMIT.windowMs,
  })
  await Promise.all(decision.staleBucketIds.map((id) => ctx.db.delete(id)))
  if (!decision.allowed) {
    return { allowed: false, retryAfterMs: decision.retryAfterMs }
  }
  if (decision.currentBucketId) {
    await ctx.db.patch(decision.currentBucketId, {
      count: decision.currentCount + 1,
    })
  } else {
    await ctx.db.insert("apiRateLimits", {
      actorKey,
      bucket: RESERVE_RATE_BUCKET,
      windowStartMs: decision.windowStartMs,
      count: 1,
    })
  }
  return { allowed: true, retryAfterMs: 0 }
}

export type ReserveUsageResult =
  | { kind: "reserved"; reservationId: Id<"usageReservations"> }
  | { kind: "idempotent_replay"; reservationId: Id<"usageReservations"> }
  | { kind: "conflict" }
  | {
      kind: "insufficient_allowance"
      availableCredits: number
      requiredCredits: number
    }
  /** Defense-in-depth throttle — never hit by legitimate turns. */
  | { kind: "rate_limited"; retryAfterMs: number }

/**
 * Atomic platform-usage reservation — the ONE admission decision for
 * platform-funded spend. Called by the route resolver while walking platform
 * candidates; a candidate is not eligible until this succeeds. Idempotent on
 * (userId, requestId): an identical replay returns the existing reservation,
 * a payload change on a reused request id is a typed conflict.
 */
export type ReserveUsageArgs = UsageReservationArgs

/**
 * Trusted handler core, exported for tests. The registered public wrapper must
 * verify server authorization before calling it; other callers must not bypass
 * that boundary.
 */
export async function reserveUsageForUser(
  ctx: MutationCtx,
  user: Doc<"users">,
  args: ReserveUsageArgs
): Promise<ReserveUsageResult> {
  {
    if (!isValidUsageReservationArgs(args)) {
      throw new Error("Invalid usage reservation payload")
    }

    const now = Date.now()
    const fingerprint = reservationPayloadFingerprint(args)

    const existing = await ctx.db
      .query("usageReservations")
      .withIndex("by_user_request", (q) =>
        q.eq("userId", user._id).eq("requestId", args.requestId)
      )
      .unique()
    if (existing) {
      if (existing.payloadFingerprint !== fingerprint) {
        warnUsage("usage_reserve_conflict", {
          requestId: args.requestId,
          reservationId: existing._id,
        })
        return { kind: "conflict" }
      }
      // A reservation whose Stop/supersession left settlement pending is not
      // replayable either — its run is already terminal, so re-admitting the
      // request against it could only strand or double-attach.
      if (existing.settlementDeadlineAt !== undefined) {
        warnUsage("usage_reserve_replay_pending_settlement", {
          requestId: args.requestId,
          reservationId: existing._id,
        })
        return { kind: "conflict" }
      }
      // Only a still-live reservation is a valid replay: a settled or
      // released row must never re-admit a request (that would resurrect
      // spent or refunded money without a new reservation).
      if (existing.status !== "reserved") {
        warnUsage("usage_reserve_replay_not_reserved", {
          requestId: args.requestId,
          reservationId: existing._id,
          status: existing.status,
        })
        return { kind: "conflict" }
      }
      logUsage("usage_reserve_replay", {
        requestId: args.requestId,
        reservationId: existing._id,
        status: existing.status,
      })
      return { kind: "idempotent_replay", reservationId: existing._id }
    }

    // Defense in depth (ADR-0021): authorization proves the Next server
    // derived this payload, while the throttle bounds repeated legitimate
    // server admissions from one account.
    const throttle = await consumeReserveRateLimit(ctx, user._id, now)
    if (!throttle.allowed) {
      warnUsage("usage_reserve_rate_limited", {
        requestId: args.requestId,
        retryAfterMs: throttle.retryAfterMs,
      })
      return { kind: "rate_limited", retryAfterMs: throttle.retryAfterMs }
    }

    const bucket = await ensureCurrentUsageBucket(ctx, user, now)
    if (bucket.availableCredits < args.estimatedCredits) {
      logUsage("usage_reserve_denied", {
        requestId: args.requestId,
        modelId: args.modelId,
        routeId: args.routeId,
        requiredCredits: args.estimatedCredits,
        availableCredits: bucket.availableCredits,
      })
      return {
        kind: "insufficient_allowance",
        availableCredits: bucket.availableCredits,
        requiredCredits: args.estimatedCredits,
      }
    }

    const reservationId = await ctx.db.insert("usageReservations", {
      userId: user._id,
      requestId: args.requestId,
      bucketId: bucket._id,
      chatId: args.chatId,
      modelId: args.modelId,
      routeId: args.routeId,
      providerId: args.providerId,
      status: "reserved",
      estimatedCredits: args.estimatedCredits,
      reservedCredits: args.estimatedCredits,
      ...(args.estimatedInputTokens !== undefined
        ? { estimatedInputTokens: args.estimatedInputTokens }
        : {}),
      ...(args.estimatedOutputTokens !== undefined
        ? { estimatedOutputTokens: args.estimatedOutputTokens }
        : {}),
      ...(args.titleEstimatedCredits !== undefined
        ? { titleEstimatedCredits: args.titleEstimatedCredits }
        : {}),
      ...(args.titleEstimatedInputTokens !== undefined
        ? { titleEstimatedInputTokens: args.titleEstimatedInputTokens }
        : {}),
      pricingSnapshot: args.pricingSnapshot,
      payloadFingerprint: fingerprint,
      reservedAt: now,
      updatedAt: now,
    })
    const next = applyReserve(bucket, args.estimatedCredits)
    await patchBucketBalances(
      ctx,
      bucket,
      {
        availableCredits: next.availableCredits,
        reservedCredits: next.reservedCredits,
        spentCredits: next.spentCredits,
      },
      now
    )
    await insertLedgerEntry(ctx, {
      userId: user._id,
      bucketId: bucket._id,
      reservationId,
      eventKey: reserveEventKey(reservationId),
      type: "reserve",
      deltaAvailableCredits: -args.estimatedCredits,
      deltaReservedCredits: args.estimatedCredits,
      deltaSpentCredits: 0,
      revision: args.pricingSnapshot.revision,
      createdAt: now,
    })
    logUsage("usage_reserved", {
      requestId: args.requestId,
      reservationId,
      modelId: args.modelId,
      routeId: args.routeId,
      estimatedCredits: args.estimatedCredits,
    })
    return { kind: "reserved", reservationId }
  }
}

const vReserveUsageResult = v.union(
  v.object({
    kind: v.literal("reserved"),
    reservationId: v.id("usageReservations"),
  }),
  v.object({
    kind: v.literal("idempotent_replay"),
    reservationId: v.id("usageReservations"),
  }),
  v.object({ kind: v.literal("conflict") }),
  v.object({
    kind: v.literal("insufficient_allowance"),
    availableCredits: v.number(),
    requiredCredits: v.number(),
  }),
  v.object({
    kind: v.literal("rate_limited"),
    retryAfterMs: v.number(),
  })
)

type AuthenticatedMutationCtx = MutationCtx & { user: Doc<"users"> }

export type AuthorizedReserveUsageArgs = ReserveUsageArgs & {
  authorizationIssuedAt: number
  authorizationProof: string
}

/**
 * Testable public-boundary handler. Its user comes only from the authenticated
 * Convex context, never from caller arguments, and authorization runs before
 * the trusted core can read or write allowance state.
 */
export async function reserveAuthorizedHandler(
  ctx: AuthenticatedMutationCtx,
  args: AuthorizedReserveUsageArgs
): Promise<ReserveUsageResult> {
  const { authorizationIssuedAt, authorizationProof, ...reservationArgs } = args
  const authorized = verifyUsageReservationAuthorization(
    {
      ...reservationArgs,
      workosUserId: ctx.user.workosUserId,
      deploymentUrl: usageReservationAuthorizationAudience(
        process.env.CONVEX_CLOUD_URL
      ),
      issuedAt: authorizationIssuedAt,
    },
    authorizationProof
  )
  if (!authorized) {
    warnUsage("usage_reserve_authorization_rejected", {
      requestId: reservationArgs.requestId,
      userId: ctx.user._id,
    })
    throw new Error("Invalid usage reservation authorization")
  }
  return reserveUsageForUser(ctx, ctx.user, reservationArgs)
}

/**
 * Atomic platform-usage reservation — the ONE admission decision for
 * platform-funded spend (see reserveUsageForUser). The Next server signs the
 * complete reservation payload, making server authorization mandatory on the
 * trusted path.
 */
export const reserveAuthorized = authenticatedMutation({
  args: {
    ...usageReservationArgValidators,
    authorizationIssuedAt: v.number(),
    authorizationProof: v.string(),
  },
  returns: vReserveUsageResult,
  handler: reserveAuthorizedHandler,
})

/**
 * Attach a reservation to the run its request produced — called inside
 * prepareGeneration's transaction, with the reservation id verified by the
 * signed admission proof. Fails closed: a platform-funded run must never be
 * created without its accounting record.
 */
export async function attachReservationToRun(
  ctx: MutationCtx,
  args: {
    reservationId: Id<"usageReservations">
    requestId: string
    userId: Id<"users">
    runId: Id<"generationRuns">
    now: number
  }
): Promise<void> {
  const reservation = await ctx.db.get(args.reservationId)
  if (
    !reservation ||
    reservation.userId !== args.userId ||
    reservation.requestId !== args.requestId ||
    reservation.status !== "reserved" ||
    reservation.generationRunId !== undefined
  ) {
    throw new Error("Usage reservation cannot be attached to this run")
  }
  await ctx.db.patch(args.reservationId, {
    generationRunId: args.runId,
    attachedAt: args.now,
    updatedAt: args.now,
  })
}

/**
 * Release a reservation whose request died BEFORE a run existed (prepare
 * failure, guest-adapter anomaly). Only the owner's own, still-unattached,
 * still-reserved row releases — provider work structurally cannot have
 * started without a run, so this can never refund consumed usage. Idempotent.
 */
/** Handler core, exported for tests (the registered wrapper injects ctx.user). */
export async function releaseUnattachedForUser(
  ctx: MutationCtx,
  user: Doc<"users">,
  requestId: string
): Promise<{ released: boolean }> {
  const reservation = await ctx.db
    .query("usageReservations")
    .withIndex("by_user_request", (q) =>
      q.eq("userId", user._id).eq("requestId", requestId)
    )
    .unique()
  if (
    !reservation ||
    reservation.status !== "reserved" ||
    reservation.generationRunId !== undefined
  ) {
    return { released: false }
  }
  await releaseReservation(ctx, reservation, "pre_runtime_failure", Date.now())
  return { released: true }
}

export const releaseUnattached = authenticatedMutation({
  args: { requestId: v.string() },
  handler: async (ctx, { requestId }) =>
    releaseUnattachedForUser(ctx, ctx.user, requestId),
})

async function releaseReservation(
  ctx: MutationCtx,
  reservation: Doc<"usageReservations">,
  reason: string,
  now: number
): Promise<void> {
  const bucket = await ctx.db.get(reservation.bucketId)
  if (!bucket) throw new Error("Usage bucket missing for reservation")
  const next = applyRelease(bucket, reservation.reservedCredits)
  await patchBucketBalances(
    ctx,
    bucket,
    {
      availableCredits: next.availableCredits,
      reservedCredits: next.reservedCredits,
      spentCredits: next.spentCredits,
    },
    now
  )
  await ctx.db.patch(reservation._id, {
    status: "released",
    releasedAt: now,
    terminalReason: reason,
    updatedAt: now,
  })
  await insertLedgerEntry(ctx, {
    userId: reservation.userId,
    bucketId: bucket._id,
    reservationId: reservation._id,
    eventKey: releaseEventKey(reservation._id),
    type: "release",
    deltaAvailableCredits: reservation.reservedCredits,
    deltaReservedCredits: -reservation.reservedCredits,
    deltaSpentCredits: 0,
    reason,
    createdAt: now,
  })
  logUsage("usage_released", {
    reservationId: reservation._id,
    requestId: reservation.requestId,
    reservedCredits: reservation.reservedCredits,
    reason,
  })
}

async function settleReservation(
  ctx: MutationCtx,
  reservation: Doc<"usageReservations">,
  settlement: {
    actualCredits: number
    basis: SettlementBasis
    inputTokens?: number
    outputTokens?: number
    titleCredits?: number
    reason: string
  },
  now: number
): Promise<void> {
  const bucket = await ctx.db.get(reservation.bucketId)
  if (!bucket) throw new Error("Usage bucket missing for reservation")
  const next = applySettle(
    bucket,
    reservation.reservedCredits,
    settlement.actualCredits
  )
  await patchBucketBalances(
    ctx,
    bucket,
    {
      availableCredits: next.availableCredits,
      reservedCredits: next.reservedCredits,
      spentCredits: next.spentCredits,
    },
    now
  )
  await ctx.db.patch(reservation._id, {
    status: "settled",
    actualCredits: settlement.actualCredits,
    settlementBasis: settlement.basis,
    inputTokens: settlement.inputTokens,
    outputTokens: settlement.outputTokens,
    titleCredits: settlement.titleCredits,
    settledAt: now,
    terminalReason: settlement.reason,
    updatedAt: now,
  })
  await insertLedgerEntry(ctx, {
    userId: reservation.userId,
    bucketId: bucket._id,
    reservationId: reservation._id,
    eventKey: settleEventKey(reservation._id),
    type: "settle",
    deltaAvailableCredits:
      reservation.reservedCredits - settlement.actualCredits,
    deltaReservedCredits: -reservation.reservedCredits,
    deltaSpentCredits: settlement.actualCredits,
    reason: settlement.reason,
    createdAt: now,
  })
  logUsage("usage_settled", {
    reservationId: reservation._id,
    requestId: reservation.requestId,
    reservedCredits: reservation.reservedCredits,
    actualCredits: settlement.actualCredits,
    basis: settlement.basis,
    reason: settlement.reason,
    negativeBalance: next.availableCredits < 0,
  })
  if (next.availableCredits < 0) {
    warnUsage("usage_balance_negative", {
      bucketId: bucket._id,
      availableCredits: next.availableCredits,
    })
  }
}

// --- Cancellation-aware deferred settlement (ADR-0021 cancellation
// amendment). A user Stop or supersession no longer converts the worst-case
// admission reservation into final spend: the run terminalizes immediately,
// the reservation stays held for a bounded evidence window, and either the
// stopped worker's settlement-only receipt or the deadline reconciler
// finalizes from the best available evidence.

function reservationTerminalFacts(
  reservation: Doc<"usageReservations">
): TerminalReservationFacts {
  return {
    reservedCredits: reservation.reservedCredits,
    estimatedInputTokens: reservation.estimatedInputTokens,
    estimatedOutputTokens: reservation.estimatedOutputTokens,
    titleEstimatedCredits: reservation.titleEstimatedCredits,
    titleEstimatedInputTokens: reservation.titleEstimatedInputTokens,
    pricingSnapshot: reservation.pricingSnapshot,
  }
}

/**
 * Could the provider have started billable work for this run? Any durable
 * evidence answers yes; with none, the run may still have dispatched (the
 * work-start write is fire-and-forget), so callers must treat this as a
 * fallback discriminator, never as proof by itself.
 */
export function runProviderMayHaveStarted(run: Doc<"generationRuns">): boolean {
  return (
    run.workStartedAt !== undefined ||
    (run.lastSnapshotSequence ?? 0) > 0 ||
    (run.inputTokens ?? 0) > 0 ||
    (run.outputTokens ?? 0) > 0
  )
}

/** Apply one pure settlement decision to a still-reserved reservation. */
async function applyTerminalSettlementDecision(
  ctx: MutationCtx,
  reservation: Doc<"usageReservations">,
  decision: TerminalSettlementDecision,
  reason: string,
  now: number
): Promise<void> {
  if (decision.kind === "release") {
    await releaseReservation(ctx, reservation, reason, now)
  } else {
    if (decision.titleRouteUnrecognized) {
      warnUsage("usage_title_route_unrecognized", {
        reservationId: reservation._id,
        runId: reservation.generationRunId,
        reason,
      })
    }
    if (decision.uncappedCredits !== undefined) {
      logUsage("usage_terminal_fallback_capped", {
        reservationId: reservation._id,
        uncappedCredits: decision.uncappedCredits,
        reservedCredits: reservation.reservedCredits,
      })
    }
    await settleReservation(
      ctx,
      reservation,
      {
        actualCredits: decision.actualCredits,
        basis: decision.basis,
        inputTokens: decision.inputTokens,
        outputTokens: decision.outputTokens,
        titleCredits: decision.titleCredits,
        reason,
      },
      now
    )
  }
  // Settlement-only authority ends with finalization; the pending/deadline
  // timestamps stay behind as audit facts.
  await ctx.db.patch(reservation._id, {
    ...(decision.kind === "settle"
      ? { titleSettlementBasis: decision.titleBasis }
      : {}),
    settlementGrantDigest: undefined,
    settlementGrantExpiresAt: undefined,
    updatedAt: now,
  })
}

/**
 * Mark a Stop/supersession's reservation ACCOUNTING-PENDING instead of
 * settling it in the terminal transaction. Runs inside the same mutation that
 * commits `aborted` and revokes the normal grant; the reservation keeps
 * status "reserved" (still counted in bucket.reservedCredits, still blocking
 * concurrent overspend) until the worker's receipt or the deadline
 * reconciler finalizes. Returns true when accounting is handled here — the
 * caller must then skip `settleUsageForTerminalRun`.
 */
export async function deferUsageSettlementForTerminalRun(
  ctx: MutationCtx,
  run: Doc<"generationRuns">,
  terminalReason: Extract<
    GenerationRunTerminalReason,
    "user_stop" | "superseded"
  >,
  now: number
): Promise<boolean> {
  const reservation = await ctx.db
    .query("usageReservations")
    .withIndex("by_run", (q) => q.eq("generationRunId", run._id))
    .unique()
  // No reservation (BYOK/anonymous) or already finalized (an approval pause
  // settled it): nothing to defer, nothing for the legacy path to add.
  if (!reservation || reservation.status !== "reserved") return true
  if (reservation.settlementDeadlineAt !== undefined) return true

  // Structural release: a run that never crossed the execution boundary
  // cannot have dispatched provider work. (Committed runs are "streaming"+
  // in practice, so cancellation almost always defers.)
  if (run.status === "queued") {
    await releaseReservation(ctx, reservation, terminalReason, now)
    return true
  }

  // Durable partial-output fallback, captured NOW so message/run deletion
  // cannot erase it. A later worker receipt may replace it with a larger
  // final-snapshot estimate; the two are never added together.
  const message = run.assistantMessageId
    ? await ctx.db.get(run.assistantMessageId)
    : null
  const partialEstimate = message
    ? estimatePartialOutputTokens(message.parts)
    : 0
  const terminalEstimatedOutputTokens =
    reservation.estimatedOutputTokens !== undefined
      ? Math.min(partialEstimate, reservation.estimatedOutputTokens)
      : partialEstimate

  const settlementDeadlineAt = now + TERMINAL_EVIDENCE_WINDOW_MS
  await ctx.db.patch(reservation._id, {
    terminalPendingAt: now,
    settlementDeadlineAt,
    // The stopped worker keeps ONE narrowly scoped capability: submitting the
    // terminal-usage receipt for exactly this reservation, until the same
    // deadline the reconciler enforces. Its normal run grant is revoked in
    // this same transaction.
    ...(run.grantDigest
      ? {
          settlementGrantDigest: run.grantDigest,
          settlementGrantExpiresAt: settlementDeadlineAt,
        }
      : {}),
    providerMayHaveStarted: runProviderMayHaveStarted(run),
    terminalEstimatedOutputTokens,
    updatedAt: now,
  })
  logUsage("usage_terminal_settlement_pending", {
    reservationId: reservation._id,
    runId: run._id,
    terminalReason,
    settlementDeadlineAt,
    estimatedInputTokens: reservation.estimatedInputTokens,
    terminalEstimatedOutputTokens,
  })
  return true
}

export type FinalizeTerminalUsageOutcome =
  "settled" | "released" | "already-finalized"

/**
 * Finalize one pending cancellation settlement from normalized evidence —
 * the ONE finalization path shared by the worker's settlement-only receipt
 * and the deadline reconciler, so there are never two billing decision
 * trees. First finalization wins; later evidence is logged and ignored.
 */
export async function finalizePendingTerminalUsage(
  ctx: MutationCtx,
  args: {
    reservation: Doc<"usageReservations">
    evidence: TerminalUsageEvidencePayload
    source: "worker_receipt" | "deadline"
    now: number
  }
): Promise<FinalizeTerminalUsageOutcome> {
  const { reservation, evidence, source, now } = args
  if (reservation.status !== "reserved") {
    warnUsage("usage_terminal_late_evidence_ignored", {
      reservationId: reservation._id,
      storedBasis: reservation.settlementBasis,
      status: reservation.status,
      incomingPrimaryKind: evidence.primary.kind,
      incomingTitleKind: evidence.title.kind,
      source,
    })
    return "already-finalized"
  }
  const decision = resolveTerminalUsageSettlement(
    reservationTerminalFacts(reservation),
    evidence
  )
  const reason =
    source === "worker_receipt"
      ? "terminal_usage_receipt"
      : "settlement_deadline_expired"
  await applyTerminalSettlementDecision(ctx, reservation, decision, reason, now)
  const eventTag =
    source === "worker_receipt"
      ? "usage_terminal_evidence_accepted"
      : "usage_terminal_evidence_timed_out"
  logUsage(eventTag, {
    reservationId: reservation._id,
    primaryKind: evidence.primary.kind,
    primaryBasis: decision.kind === "settle" ? decision.basis : "released",
    titleBasis: decision.kind === "settle" ? decision.titleBasis : "released",
    finalCredits: decision.kind === "settle" ? decision.actualCredits : 0,
    evidenceLatencyMs:
      reservation.terminalPendingAt !== undefined
        ? now - reservation.terminalPendingAt
        : null,
  })
  return decision.kind === "settle" ? "settled" : "released"
}

/**
 * Evidence for a pending reservation whose worker never reported: durable
 * run facts when the run survives, the facts copied onto the reservation at
 * Stop time when it did not.
 */
function terminalSettlementFallbackEvidence(
  reservation: Doc<"usageReservations">,
  run: Doc<"generationRuns"> | null
): TerminalUsageEvidencePayload {
  const observedInput = run?.inputTokens ?? 0
  const observedOutput = run?.outputTokens ?? 0
  if (observedInput > 0 || observedOutput > 0) {
    return {
      primary: {
        kind: "completed-steps",
        inputTokens: run?.inputTokens,
        outputTokens: run?.outputTokens,
        partialOutputTokens: reservation.terminalEstimatedOutputTokens,
      },
      title: { kind: "started-without-usage" },
    }
  }
  const mayHaveStarted =
    reservation.providerMayHaveStarted ??
    (run ? runProviderMayHaveStarted(run) : true)
  if (!mayHaveStarted) {
    return { primary: { kind: "not-started" }, title: { kind: "not-run" } }
  }
  return {
    primary: {
      kind: "started-without-usage",
      partialOutputTokens: reservation.terminalEstimatedOutputTokens,
    },
    title: { kind: "started-without-usage" },
  }
}

/**
 * Deadline reconciliation for pending cancellation settlements: bounded,
 * idempotent, run on a second-level cadence so a due reservation converges
 * within at most two intervals. The 30-minute stale reconciler below remains
 * the final deployment/crash net.
 */
export async function reconcileDueTerminalSettlementsPass(
  ctx: MutationCtx
): Promise<{ finalized: number }> {
  const now = Date.now()
  const due = await ctx.db
    .query("usageReservations")
    .withIndex("by_status_settlement_deadline", (q) =>
      q
        .eq("status", "reserved")
        .gt("settlementDeadlineAt", undefined)
        .lte("settlementDeadlineAt", now)
    )
    .take(RECONCILE_BATCH_LIMIT)

  let finalized = 0
  for (const reservation of due) {
    if (
      reservation.settlementDeadlineAt === undefined ||
      reservation.settlementDeadlineAt > now
    ) {
      continue
    }
    const run = reservation.generationRunId
      ? await ctx.db.get(reservation.generationRunId)
      : null
    const outcome = await finalizePendingTerminalUsage(ctx, {
      reservation,
      evidence: terminalSettlementFallbackEvidence(reservation, run),
      source: "deadline",
      now,
    })
    if (outcome !== "already-finalized") finalized++
  }
  return { finalized }
}

export const reconcileDueTerminalSettlements = internalMutation({
  args: {},
  handler: async (ctx) => reconcileDueTerminalSettlementsPass(ctx),
})

type LegacyTitleUsageEvidence = UsageTokens & {
  routeId?: never
  pricingRole?: never
}

type RoutedTitleUsageEvidence = UsageTokens & {
  routeId: string
  pricingRole: "title" | "primary"
}

/** The completion write's title-usage evidence (ADR-0021). */
export type TitleUsageEvidence =
  LegacyTitleUsageEvidence | RoutedTitleUsageEvidence | "not-run" | "unknown"

export type TerminalUsageEvidence = {
  /** Provider-reported aggregate usage — present only on the completion path. */
  usage?: UsageTokens
  /** Title-call evidence riding the completion write. */
  titleUsage?: TitleUsageEvidence
  /**
   * Normalized cancellation evidence riding a worker-owned aborted terminal
   * write (ADR-0021 cancellation amendment). When present, settlement routes
   * through the shared pure decision instead of the legacy estimate.
   */
  terminal?: TerminalUsageEvidencePayload
}

function resolveTitleUsageRate(
  snapshot: PricingSnapshot,
  titleUsage: LegacyTitleUsageEvidence | RoutedTitleUsageEvidence
): PricingSnapshot["primary"] | undefined {
  // Compatibility for active workers from before priced-route evidence: they
  // could only report token counts, which historically meant the title route.
  if (
    titleUsage.routeId === undefined ||
    titleUsage.pricingRole === undefined
  ) {
    return snapshot.title ?? snapshot.primary
  }
  const rate =
    titleUsage.pricingRole === "primary"
      ? snapshot.primary
      : (snapshot.title ?? snapshot.primary)
  return rate.routeId === titleUsage.routeId ? rate : undefined
}

/**
 * The ONE accounting decision for a run's terminal transition (ADR-0021's
 * provider-boundary rule). Invoked inside the same mutation that commits the
 * lifecycle transition, for EVERY terminal path — completion, failure, abort,
 * stop, supersession, and all three reapers. Idempotent: a duplicate terminal
 * or an already-settled reservation changes nothing; a run without a
 * reservation (BYOK, anonymous, or pre-allowance) is a structural no-op.
 */
export async function settleUsageForTerminalRun(
  ctx: MutationCtx,
  run: Doc<"generationRuns">,
  evidence: TerminalUsageEvidence = {},
  auditReason = "terminal",
  // Boundary discriminator, typed: the run's terminal cause decides the
  // release-vs-settle branch; `auditReason` is ledger text only and never
  // drives billing. Live callers pass verdict.run.terminalReason explicitly
  // (their in-memory `run` predates the terminal patch); the reconciler
  // omits it and the stored value on the run doc is used.
  terminalReason: GenerationRunTerminalReason | undefined = run.terminalReason
): Promise<void> {
  const reservation = await ctx.db
    .query("usageReservations")
    .withIndex("by_run", (q) => q.eq("generationRunId", run._id))
    .unique()
  if (!reservation) return
  if (reservation.status === "settled") {
    // Duplicate terminal delivery — the first settlement stands. Evidence-free
    // duplicates (reaper re-delivery) are the benign idempotent case; a
    // duplicate whose evidence DISAGREES with the settled facts is a
    // conflicting second settlement (ADR-0021): logged as an invariant
    // violation and rejected — never re-billed.
    const conflicting =
      evidence.usage !== undefined &&
      (evidence.usage.inputTokens !== reservation.inputTokens ||
        evidence.usage.outputTokens !== reservation.outputTokens)
    if (conflicting) {
      warnUsage("usage_settle_conflict_rejected", {
        reservationId: reservation._id,
        runId: run._id,
        storedBasis: reservation.settlementBasis,
        storedInputTokens: reservation.inputTokens,
        storedOutputTokens: reservation.outputTokens,
        incomingInputTokens: evidence.usage?.inputTokens,
        incomingOutputTokens: evidence.usage?.outputTokens,
        reason: auditReason,
      })
    }
    return
  }
  if (reservation.status === "released") {
    // Settle-after-release: an invariant violation, never silently re-billed.
    warnUsage("usage_settle_after_release_rejected", {
      reservationId: reservation._id,
      runId: run._id,
      reason: auditReason,
    })
    return
  }

  const now = Date.now()
  const snapshot = reservation.pricingSnapshot
  const titleEstimate = reservation.titleEstimatedCredits ?? 0

  // Evidence beats the boundary marker: `workStartedAt` is written by a
  // best-effort fire-and-forget write, so its ABSENCE must never refund a run
  // that provably consumed usage (aggregate present, or per-step
  // accumulation) — release is decided only after both evidence channels
  // come up empty.
  if (evidence.usage !== undefined) {
    // Completion path: authoritative all-steps aggregate. A title evidence
    // object without a single numeric field is NOT observed usage — the
    // provider omitted it, so the title component settles at its estimate
    // and the basis says so.
    const titleObserved =
      evidence.titleUsage !== undefined &&
      evidence.titleUsage !== "unknown" &&
      evidence.titleUsage !== "not-run" &&
      (typeof evidence.titleUsage.inputTokens === "number" ||
        typeof evidence.titleUsage.outputTokens === "number")
        ? evidence.titleUsage
        : undefined
    const titleRate = titleObserved
      ? resolveTitleUsageRate(snapshot, titleObserved)
      : undefined
    if (titleObserved && !titleRate) {
      // The worker is trusted, but only reservation-pinned rates may move
      // allowance. Preserve completion and settle conservatively at the title
      // estimate while making route drift visible for investigation.
      warnUsage("usage_title_route_unrecognized", {
        reservationId: reservation._id,
        runId: run._id,
        routeId: titleObserved.routeId,
        pricingRole: titleObserved.pricingRole,
        primaryRouteId: snapshot.primary.routeId,
        titleRouteId: snapshot.title?.routeId,
      })
    }
    const titleCredits =
      evidence.titleUsage === "not-run"
        ? 0
        : titleObserved && titleRate
          ? computeUsageCredits(titleRate, titleObserved)
          : titleEstimate
    const basis: SettlementBasis =
      evidence.titleUsage === "not-run" || (titleObserved && titleRate)
        ? "actual"
        : "actual_with_estimated_title"
    await settleReservation(
      ctx,
      reservation,
      {
        actualCredits:
          computeUsageCredits(snapshot.primary, evidence.usage) + titleCredits,
        basis,
        inputTokens: evidence.usage.inputTokens,
        outputTokens: evidence.usage.outputTokens,
        titleCredits,
        reason: auditReason,
      },
      now
    )
    return
  }

  // Worker-owned cancellation with normalized evidence (a `request_aborted`
  // terminal that beat any Stop): settle atomically through the shared pure
  // decision — the same tree the receipt and deadline paths use.
  if (evidence.terminal !== undefined) {
    const decision = resolveTerminalUsageSettlement(
      reservationTerminalFacts(reservation),
      evidence.terminal
    )
    await applyTerminalSettlementDecision(
      ctx,
      reservation,
      decision,
      auditReason,
      now
    )
    return
  }

  // A reaped lease has no live worker to acknowledge anything: settle
  // immediately from durable completed-step and partial-output facts using
  // the SAME fallback policy the deadline reconciler applies (never the
  // legacy full-estimate charge).
  if (terminalReason === "lease_expired") {
    const message = run.assistantMessageId
      ? await ctx.db.get(run.assistantMessageId)
      : null
    const partialEstimate = message
      ? estimatePartialOutputTokens(message.parts)
      : 0
    const withPartial: Doc<"usageReservations"> = {
      ...reservation,
      terminalEstimatedOutputTokens:
        reservation.estimatedOutputTokens !== undefined
          ? Math.min(partialEstimate, reservation.estimatedOutputTokens)
          : partialEstimate,
    }
    const decision = resolveTerminalUsageSettlement(
      reservationTerminalFacts(reservation),
      terminalSettlementFallbackEvidence(withPartial, run)
    )
    await applyTerminalSettlementDecision(
      ctx,
      reservation,
      decision,
      auditReason,
      now
    )
    return
  }

  // Abort/failure/reaper paths: per-step accumulated evidence when any step
  // completed. The title component is charged at its estimate (conservative;
  // documented in ADR-0021).
  const observed: UsageTokens = {
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
  }
  const hasObservedUsage =
    (observed.inputTokens ?? 0) > 0 || (observed.outputTokens ?? 0) > 0
  if (hasObservedUsage) {
    await settleReservation(
      ctx,
      reservation,
      {
        actualCredits:
          computeUsageCredits(snapshot.primary, observed) + titleEstimate,
        basis: "observed_partial",
        inputTokens: observed.inputTokens,
        outputTokens: observed.outputTokens,
        titleCredits: titleEstimate,
        reason: auditReason,
      },
      now
    )
    return
  }

  // No usage evidence at all. Release when provider consumption provably
  // never began: either the work-start boundary was never crossed, or the
  // provider rejected the request before producing ANY output (failed
  // requests are not billed; `lastSnapshotSequence` counts accepted content
  // checkpoints, so zero means no text or reasoning ever streamed). A user
  // Stop or a reaped lease keeps the conservative estimate — the provider
  // may have generated tokens nobody observed.
  if (run.workStartedAt === undefined) {
    await releaseReservation(ctx, reservation, auditReason, now)
    return
  }
  if (
    terminalReason === "provider_error" &&
    (run.lastSnapshotSequence ?? 0) === 0
  ) {
    await releaseReservation(
      ctx,
      reservation,
      "provider_error_before_output",
      now
    )
    return
  }

  await settleReservation(
    ctx,
    reservation,
    {
      actualCredits: reservation.reservedCredits,
      basis: "estimated_after_unknown_usage",
      titleCredits: titleEstimate,
      reason: auditReason,
    },
    now
  )
}

/**
 * The allowance view the settings UI subscribes to (per-user subscription).
 * Read-only: when no bucket exists for the current period yet, project the
 * plan's would-be grant instead of writing (queries cannot mint the bucket;
 * the first reservation materializes it).
 */
export const getCurrentAllowance = authenticatedQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const period = currentPlanPeriod(now)
    const plan = resolvePlanPolicy(ctx.user)
    const bucket = await ctx.db
      .query("usageBuckets")
      .withIndex("by_user_kind_period", (q) =>
        q
          .eq("userId", ctx.user._id)
          .eq("bucketKind", "included")
          .eq("periodKey", period.periodKey)
      )
      .unique()

    if (!bucket) {
      return {
        planId: plan.planId,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        grantedCredits: plan.includedCreditsPerPeriod,
        availableCredits: plan.includedCreditsPerPeriod,
        reservedCredits: 0,
        spentCredits: 0,
      }
    }

    return {
      planId: bucket.planId,
      periodStart: bucket.periodStart,
      periodEnd: bucket.periodEnd,
      grantedCredits: bucket.grantedCredits,
      availableCredits: bucket.availableCredits,
      reservedCredits: bucket.reservedCredits,
      spentCredits: bucket.spentCredits,
    }
  },
})

// Bounded reconciliation (ADR-0021): the final safety net for reservations
// whose settlement was lost to exhausted retries, deploys, or crashes.
// Idempotent and bounded per tick; never releases after provider work may
// have begun (the boundary rule inside settleUsageForTerminalRun decides).
const RECONCILE_BATCH_LIMIT = 25

export async function reconcileStaleUsageReservationsPass(
  ctx: MutationCtx
): Promise<{ reconciled: number; skipped: number }> {
  const now = Date.now()
  const staleBefore = now - STALE_RESERVATION_MS
  const candidates = await ctx.db
    .query("usageReservations")
    .withIndex("by_status_reserved_at", (q) =>
      q.eq("status", "reserved").lt("reservedAt", staleBefore)
    )
    .take(RECONCILE_BATCH_LIMIT)

  let reconciled = 0
  let skipped = 0
  for (const reservation of candidates) {
    if (reservation.settlementDeadlineAt !== undefined) {
      // A pending cancellation settlement that somehow outlived its deadline
      // AND the deadline reconciler: finalize through the same fallback path,
      // never the legacy full-estimate charge.
      const pendingRun = reservation.generationRunId
        ? await ctx.db.get(reservation.generationRunId)
        : null
      await finalizePendingTerminalUsage(ctx, {
        reservation,
        evidence: terminalSettlementFallbackEvidence(reservation, pendingRun),
        source: "deadline",
        now,
      })
      reconciled++
      continue
    }
    if (reservation.generationRunId === undefined) {
      // No run was ever created — provider work structurally never began.
      await releaseReservation(ctx, reservation, "reconciled_unattached", now)
      reconciled++
      continue
    }
    const run = await ctx.db.get(reservation.generationRunId)
    if (!run) {
      // The run row is gone (chat deletion raced settlement). Provider work
      // may have begun — settle the estimate rather than blindly refund.
      await settleReservation(
        ctx,
        reservation,
        {
          actualCredits: reservation.reservedCredits,
          basis: "estimated_after_unknown_usage",
          titleCredits: reservation.titleEstimatedCredits ?? 0,
          reason: "reconciled_run_missing",
        },
        now
      )
      reconciled++
      continue
    }
    const isTerminal =
      run.status === "completed" ||
      run.status === "failed" ||
      run.status === "aborted"
    if (!isTerminal) {
      // Still live (or paused) — the run reapers own terminalizing it, and
      // that terminal path settles. Skip, never race a live run.
      skipped++
      continue
    }
    await settleUsageForTerminalRun(ctx, run, {}, "reconciled_terminal_run")
    reconciled++
  }
  if (reconciled > 0 || skipped > 0) {
    logUsage("usage_reservations_reconciled", { reconciled, skipped })
  }
  return { reconciled, skipped }
}

export const reconcileStaleUsageReservations = internalMutation({
  args: {},
  handler: async (ctx) => reconcileStaleUsageReservationsPass(ctx),
})

/**
 * Administrative balance correction (ADR-0021): the ONE sanctioned way to
 * change a bucket's balance outside reserve/settle/release. Never edits
 * history — it appends a compensating "adjustment" ledger entry and moves
 * `availableCredits` only (spent/reserved stay evidence of what actually
 * happened). Internal-only: reachable from the dashboard/CLI, never from
 * clients. `eventKey` is caller-supplied so a retried adjustment with the
 * same key is idempotent instead of double-applied.
 */
export const recordAdjustment = internalMutation({
  args: {
    bucketId: v.id("usageBuckets"),
    /** Signed credit delta applied to availableCredits AND grantedCredits
     * (granted moves with it so the materialized invariant keeps holding —
     * an adjustment is economically a grant correction). */
    deltaCredits: v.number(),
    /** Idempotency key, e.g. "adjustment:2026-08-20:support-1234". */
    eventKey: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    if (
      !Number.isSafeInteger(args.deltaCredits) ||
      args.deltaCredits === 0 ||
      !args.eventKey.startsWith("adjustment:")
    ) {
      throw new Error(
        "Adjustment requires a non-zero integer delta and an adjustment:* event key"
      )
    }
    const bucket = await ctx.db.get(args.bucketId)
    if (!bucket) throw new Error("Bucket not found")
    const now = Date.now()
    const applied = await insertLedgerEntry(ctx, {
      userId: bucket.userId,
      bucketId: bucket._id,
      eventKey: args.eventKey,
      type: "adjustment",
      deltaAvailableCredits: args.deltaCredits,
      deltaReservedCredits: 0,
      deltaSpentCredits: 0,
      reason: args.reason,
      createdAt: now,
    })
    if (!applied) return { applied: false as const }
    await ctx.db.patch(bucket._id, {
      grantedCredits: bucket.grantedCredits + args.deltaCredits,
      availableCredits: bucket.availableCredits + args.deltaCredits,
      updatedAt: now,
    })
    logUsage("usage_adjustment_applied", {
      bucketId: bucket._id,
      deltaCredits: args.deltaCredits,
      eventKey: args.eventKey,
    })
    return { applied: true as const }
  },
})

/**
 * Ops audit: prove one bucket's materialized balance from its ledger. The
 * per-bucket entry set is naturally bounded (one grant + a few rows per
 * request); run per bucket, not as a table scan.
 */
export const auditUsageBucket = internalQuery({
  args: { bucketId: v.id("usageBuckets") },
  handler: async (ctx, { bucketId }) => {
    const bucket = await ctx.db.get(bucketId)
    if (!bucket) return { ok: false as const, reason: "bucket_missing" }
    const entries = await ctx.db
      .query("usageLedgerEntries")
      .withIndex("by_bucket", (q) => q.eq("bucketId", bucketId))
      .collect()
    const folded = entries.reduce(
      (sum, entry) => ({
        available: sum.available + entry.deltaAvailableCredits,
        reserved: sum.reserved + entry.deltaReservedCredits,
        spent: sum.spent + entry.deltaSpentCredits,
      }),
      { available: 0, reserved: 0, spent: 0 }
    )
    const matches =
      folded.available === bucket.availableCredits &&
      folded.reserved === bucket.reservedCredits &&
      folded.spent === bucket.spentCredits &&
      bucketInvariantHolds(bucket)
    return {
      ok: matches,
      folded,
      bucket: {
        grantedCredits: bucket.grantedCredits,
        availableCredits: bucket.availableCredits,
        reservedCredits: bucket.reservedCredits,
        spentCredits: bucket.spentCredits,
      },
    }
  },
})
