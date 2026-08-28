import { cronJobs } from "convex/server"
import { internal } from "./_generated/api"
import { REAPER_INTERVAL_MS } from "./domain/generation_run_liveness"

// Durable-turn reconciliation (gameplan §6, PR 3). Convex crons run
// second-level intervals and SKIP (never queue) a tick while the previous run
// of the same cron is still executing — which fits the bounded reaper design.
// Both jobs are internal mutations (transactional, exactly-once per
// invocation), never actions (at-most-once, silently droppable).
//
// Deploy-boundary drain rule: these reapers assume every active-looking run
// carries lease fields (written at prepare since PR 2). Runs from an older
// deploy carry none and are excluded by the `undefined`-excluding index
// ranges — they are settled by the next turn's supersede sweep or a one-off
// age-thresholded pass, never by lease logic.
const crons = cronJobs()

crons.interval(
  "reap expired generation run leases",
  { seconds: REAPER_INTERVAL_MS / 1000 },
  internal.chatRuntime.reapExpiredGenerationRuns,
  {}
)

crons.interval(
  "reap expired tool approvals",
  { minutes: 1 },
  internal.chatRuntime.reapExpiredToolApprovals,
  {}
)

// Resolved-approvals-without-continuation strands (the pause is lease-free and
// its approvals are no longer pending, so neither reaper above can reach it).
// The pass's own grace window — measured from the last approval's resolvedAt —
// is what protects the live approve→auto-send path; the minute cadence only
// bounds detection latency.
crons.interval(
  "reap resolved approval pauses missing their continuation",
  { minutes: 1 },
  internal.chatRuntime.reapResolvedApprovalPauses,
  {}
)

crons.interval(
  "reconcile stalled deletion jobs",
  { minutes: 10 },
  internal.deletionCleanup.reconcileStalledDeletionJobs
)

// Pending cancellation settlements (ADR-0021 cancellation amendment): a user
// Stop/supersession keeps its reservation held for a bounded evidence window;
// this pass finalizes any whose worker receipt never arrived by the deadline.
// Second-level cadence so a due reservation converges within at most two
// intervals; bounded per tick and idempotent.
crons.interval(
  "finalize due cancellation settlements",
  { seconds: 15 },
  internal.usageAllowance.reconcileDueTerminalSettlements,
  {}
)

// Stale platform-usage reservations (ADR-0021): the final accounting net for
// reservations whose settlement was lost (exhausted retries, crash, deploy).
// Bounded per tick; applies the provider-boundary rule — it never blindly
// releases a reservation after provider work may have begun.
crons.interval(
  "reconcile stale usage reservations",
  { minutes: 10 },
  internal.usageAllowance.reconcileStaleUsageReservations,
  {}
)

export default crons
