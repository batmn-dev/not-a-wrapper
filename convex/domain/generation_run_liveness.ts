import { CHAT_TURN_EXECUTION_BUDGET } from "../../lib/chat-turn/execution-budget"
import { isTerminalGenerationRunStatus } from "./message_contract"

/**
 * Generation run liveness — pure worker-writability, lease math, and ownership
 * predicates shared by prepare, heartbeat, snapshots, tools, approvals, Stop,
 * terminal writes, queries, and reaping (durable-turn gameplan §6/§12).
 *
 * Two deliberately DIFFERENT predicates guard worker writes:
 *
 *  - `isWorkerExecutingStatus` (queued/running/streaming) — heartbeats only.
 *    It excludes `awaiting_approval`: an approval pause is lease-free, so a
 *    heartbeat against a paused run answers `paused`, not a renewal. This is
 *    NOT the existing `isActiveGenerationRunStatus` (which includes the
 *    pause) — do not merge them.
 *  - content-writable (`!isTerminalGenerationRunStatus`) — snapshots, tool
 *    invocations, approval creation. It INCLUDES `awaiting_approval`: the
 *    pausing worker's era ends at its envelope finalize, so its final flush
 *    and completion downgrade must still land (gameplan §18 #5).
 *
 * No MutationCtx, no db access, no Date.now(): time crosses as an argument.
 * Server code stores deadlines; ONLY the client resolver classifies them
 * against a clock (gameplan §18 #3) — the helpers here that take `now` exist
 * for the reaper's transactional re-validation, which runs on server time
 * inside a mutation, not for query-side classification.
 */

/** Heartbeat cadence — how often the worker renews its lease. */
export const HEARTBEAT_INTERVAL_MS = 10_000

/** Lease duration — 4.5 heartbeat intervals of slack. */
export const LEASE_DURATION_MS = 45_000

/** Reaper cadence — bounds the zombie window to lease + one tick. */
export const REAPER_INTERVAL_MS = 15_000

/** Approval pause lifetime (gameplan §5 — operationally configurable). */
export const APPROVAL_EXPIRY_MS = 24 * 60 * 60 * 1000

/**
 * Grace window before the resolved-approvals reaper settles a pause whose
 * approvals are all resolved but whose continuation never dispatched. Measured
 * from the LAST approval's `resolvedAt`; must comfortably exceed the worst
 * legitimate approve → auto-send → prepare latency (MCP connects, slow
 * attachment refetches erode the prepare) so the live continuation path is
 * never raced — a too-short window would settle the pause and force the
 * in-flight continuation into the typed conflict.
 */
export const RESOLVED_APPROVAL_CONTINUATION_GRACE_MS = 5 * 60 * 1000

/**
 * Client-side clock-skew grace for lease/approval classification (resolver
 * input, gameplan §8). Lives here so the one number is shared with tests.
 */
export const LEASE_SKEW_GRACE_MS = 5_000

export type WorkerExecutingStatus = "queued" | "running" | "streaming"

/** May this run's worker still renew a heartbeat? (Pause and terminal: no.) */
export function isWorkerExecutingStatus(
  status: unknown
): status is WorkerExecutingStatus {
  return status === "queued" || status === "running" || status === "streaming"
}

/**
 * May this run still accept content writes (snapshots, tool invocations,
 * approval creation)? Includes the approval pause — see the module doc.
 */
export function isContentWritableRunStatus(status: unknown): boolean {
  return !isTerminalGenerationRunStatus(status)
}

/** The server-authored lease deadline a successful heartbeat stores. */
export function computeLeaseExpiresAt(now: number): number {
  return now + LEASE_DURATION_MS
}

/**
 * Has a stored lease expired? A run with NO lease fields is never expired —
 * the same `undefined` exclusion the reaper's index range must apply
 * (gameplan §18 #6): a lease-less row predates the heartbeat deploy and must
 * not be reaped by lease logic.
 */
export function isLeaseExpired(
  leaseExpiresAt: number | undefined,
  now: number
): boolean {
  return leaseExpiresAt !== undefined && leaseExpiresAt < now
}

/** Does this run still own its chat's live-status slot? */
export function runOwnsChatStatusSlot(
  run: { _id: string },
  chat: { statusRunId?: string }
): boolean {
  return chat.statusRunId === run._id
}

/**
 * The once-written sidebar freshness ceiling stamped at prepare
 * (`chat.liveRunFreshUntil`): no legitimate run outlives its route budget
 * plus slack. The approval pause overwrites it with the approval's own
 * expiry; terminal transitions clear it. Never rewritten per heartbeat
 * (gameplan §18 #4).
 */
export function computeLiveRunFreshUntil(startedAt: number): number {
  return (
    startedAt +
    CHAT_TURN_EXECUTION_BUDGET.routeMaxMs +
    CHAT_TURN_EXECUTION_BUDGET.liveRunFreshSlackMs
  )
}
