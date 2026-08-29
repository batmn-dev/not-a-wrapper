/**
 * Chat-turn execution budget — the one derivation every generation deadline
 * comes from.
 *
 * A Chat turn's execution is request-scoped: the provider stream, tool calls,
 * and durable settlement all happen inside one `POST /api/chat` invocation
 * bounded by the route's `maxDuration`. Every other deadline in the system is
 * a slice of, or an envelope around, that one number.
 *
 * Enforced ordering (violations throw at module load and are pinned by test):
 *
 *   provider/tool deadline
 *     < settlement-reserve boundary (route max − settlement reserve)
 *     < route max
 *     < grant expiry
 *     < reaper grace ceiling
 *
 * The client stuck-stream watchdog sits ABOVE route max (a legitimate stream
 * may run the full route budget; the watchdog only cuts streams the server
 * can no longer be running).
 *
 * Pure TS, dependency-free: imported by Convex functions (grant TTL), the
 * Next route/runtime (route max, provider deadline, settlement reserve), and
 * client hooks (stream watchdog).
 */

export type ChatTurnExecutionBudget = {
  /** Top-line route duration — `maxDuration` in ms. The single input. */
  routeMaxMs: number
  /**
   * When provider/tool consumption must be cut so settlement still fits
   * inside the route budget. The runtime's abort composition enforces it.
   */
  providerDeadlineMs: number
  /**
   * Tail of the route budget reserved for `settle()`: three terminal-write
   * attempts at the 10 s worker-write timeout would exceed any smaller
   * reserve only in the worst case, but the common case — one attempt plus
   * retry delays (250 + 1000 ms) plus the final full-parts snapshot — fits
   * with room to spare.
   */
  settlementReserveMs: number
  /** `routeMaxMs - settlementReserveMs` — where the reserve begins. */
  settlementReserveBoundaryMs: number
  /**
   * Client-side stuck-stream guard (attached streams and the detached-binding
   * watchdog). Above route max: while the route can still legitimately be
   * streaming, the client must not cut it.
   */
  clientStreamWatchdogMs: number
  /**
   * Execution-grant lifetime (ADR-0011): route max + settlement reserve +
   * slack for retry tails and clock skew. Bounds how long a leaked digest
   * preimage could authorize (idempotent, status-guarded) worker writes.
   */
  grantTtlMs: number
  /**
   * Slack added to `startedAt + routeMaxMs` when stamping
   * `chat.liveRunFreshUntil` (written once at prepare).
   */
  liveRunFreshSlackMs: number
  /**
   * Ceiling for age-based reconciliation (the reaper's one-off legacy sweep
   * and any "active run older than the budget allows" alerting). Above grant
   * expiry so nothing is reaped while its grant could still authorize writes.
   */
  reaperGraceMs: number
}

/** Derive every execution deadline from one top-line route duration. */
export function deriveChatTurnExecutionBudget(args: {
  routeMaxMs: number
}): ChatTurnExecutionBudget {
  const { routeMaxMs } = args
  const settlementReserveMs = 30_000
  const settlementReserveBoundaryMs = routeMaxMs - settlementReserveMs
  const budget: ChatTurnExecutionBudget = {
    routeMaxMs,
    settlementReserveMs,
    settlementReserveBoundaryMs,
    // 5 s under the boundary so abort propagation (signal → provider SDK →
    // stream teardown) finishes before the reserve starts.
    providerDeadlineMs: settlementReserveBoundaryMs - 5_000,
    clientStreamWatchdogMs: routeMaxMs + 30_000,
    grantTtlMs: routeMaxMs + settlementReserveMs + 90_000,
    liveRunFreshSlackMs: 30_000,
    reaperGraceMs: routeMaxMs + settlementReserveMs + 90_000 + 60_000,
  }
  assertBudgetOrdering(budget)
  return budget
}

function assertBudgetOrdering(budget: ChatTurnExecutionBudget): void {
  if (budget.providerDeadlineMs <= 0) {
    throw new Error(
      "Chat-turn execution budget ordering violated: routeMaxMs is too small to hold the settlement reserve"
    )
  }
  const orderedDurationsFromTurnStart: Array<[string, number]> = [
    ["providerDeadlineMs", budget.providerDeadlineMs],
    ["settlementReserveBoundaryMs", budget.settlementReserveBoundaryMs],
    ["routeMaxMs", budget.routeMaxMs],
    ["grantTtlMs", budget.grantTtlMs],
    ["reaperGraceMs", budget.reaperGraceMs],
  ]
  for (let i = 1; i < orderedDurationsFromTurnStart.length; i++) {
    const [prevName, prev] = orderedDurationsFromTurnStart[i - 1]
    const [nextName, next] = orderedDurationsFromTurnStart[i]
    if (!(prev < next)) {
      throw new Error(
        `Chat-turn execution budget ordering violated: ${prevName} (${prev}) must be < ${nextName} (${next})`
      )
    }
  }
  if (!(budget.clientStreamWatchdogMs > budget.routeMaxMs)) {
    throw new Error(
      "Chat-turn execution budget ordering violated: clientStreamWatchdogMs must exceed routeMaxMs"
    )
  }
}

/**
 * The route's top-line duration in SECONDS. `app/api/chat/route.ts` must
 * export `maxDuration = 300` as a literal (Next.js statically analyzes segment
 * config, so it cannot import this value); route.test.ts pins the agreement.
 * Streaming time counts toward the limit.
 */
export const CHAT_ROUTE_MAX_DURATION_SECONDS = 300

/** The one production budget. */
export const CHAT_TURN_EXECUTION_BUDGET = deriveChatTurnExecutionBudget({
  routeMaxMs: CHAT_ROUTE_MAX_DURATION_SECONDS * 1000,
})
