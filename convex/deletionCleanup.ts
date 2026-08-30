import { v } from "convex/values"
import { internal } from "./_generated/api"
import { internalMutation, type MutationCtx } from "./_generated/server"
import { runDeletionBatchImpl } from "./domain/chat_deletion"

export const runDeletionBatch = internalMutation({
  args: { jobId: v.id("deletionJobs") },
  handler: (ctx, { jobId }) => runDeletionBatchImpl(ctx, jobId),
})

const STALLED_DELETION_JOB_AGE_MS = 5 * 60 * 1000
const STALLED_DELETION_JOB_LIMIT_PER_STATE = 8
const BLOCKED_DELETION_JOB_OBSERVABILITY_LIMIT = 16

type DeletionReconciliationCtx = Pick<MutationCtx, "db" | "scheduler">

export async function reconcileStalledDeletionJobsHandler(
  ctx: DeletionReconciliationCtx,
  now = Date.now()
) {
  const staleBefore = now - STALLED_DELETION_JOB_AGE_MS
  const pending = await ctx.db
    .query("deletionJobs")
    .withIndex("by_state_updated", (q) =>
      q.eq("state", "pending").lt("updatedAt", staleBefore)
    )
    .take(STALLED_DELETION_JOB_LIMIT_PER_STATE)
  const running = await ctx.db
    .query("deletionJobs")
    .withIndex("by_state_updated", (q) =>
      q.eq("state", "running").lt("updatedAt", staleBefore)
    )
    .take(STALLED_DELETION_JOB_LIMIT_PER_STATE)
  const blocked = await ctx.db
    .query("deletionJobs")
    .withIndex("by_state_updated", (q) => q.eq("state", "blocked"))
    .take(BLOCKED_DELETION_JOB_OBSERVABILITY_LIMIT)
  const stalled = [...pending, ...running]

  for (const job of stalled) {
    await ctx.db.patch(job._id, { updatedAt: now })
    await ctx.scheduler.runAfter(
      0,
      internal.deletionCleanup.runDeletionBatch,
      { jobId: job._id }
    )
  }

  const result = {
    pending: pending.length,
    running: running.length,
    scheduled: stalled.length,
    blockedObserved: blocked.length,
    blockedCountMayBeCapped:
      blocked.length === BLOCKED_DELETION_JOB_OBSERVABILITY_LIMIT,
  }
  console.info("Deletion job reconciliation", result)
  return result
}

export const reconcileStalledDeletionJobs = internalMutation({
  args: {},
  handler: async (ctx) => await reconcileStalledDeletionJobsHandler(ctx),
})

export const resumeBlockedDeletionJob = internalMutation({
  args: { jobId: v.id("deletionJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId)
    if (!job || job.state !== "blocked") return

    await ctx.db.patch(job._id, {
      state: "pending",
      failureCode: undefined,
      updatedAt: Date.now(),
    })
    await ctx.scheduler.runAfter(
      0,
      internal.deletionCleanup.runDeletionBatch,
      { jobId }
    )
  },
})
