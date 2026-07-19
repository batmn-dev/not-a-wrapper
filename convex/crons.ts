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

export default crons
