import { getConvexSize, v, type Value } from "convex/values"
import { internal } from "./_generated/api"
import { internalMutation } from "./_generated/server"
import { runDeletionBatchImpl } from "./domain/chat_deletion"
import { isTerminalGenerationRunStatus } from "./domain/message_contract"

const LEGACY_SNAPSHOT_PURGE_PAGE = {
  numItems: 200,
  maximumRowsRead: 400,
  maximumBytesRead: 2 * 1024 * 1024,
} as const

export const purgeLegacySnapshotRows = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const snapshots = await ctx.db
      .query("assistantMessageSnapshots")
      .paginate({
        cursor: cursor ?? null,
        ...LEGACY_SNAPSHOT_PURGE_PAGE,
      })
    let rowsDeleted = 0
    let rowsSkipped = 0
    let bytesDeleted = 0

    for (const snapshot of snapshots.page) {
      const run = await ctx.db.get(snapshot.runId)
      if (run && !isTerminalGenerationRunStatus(run.status)) {
        rowsSkipped++
        continue
      }

      bytesDeleted += getConvexSize(snapshot as unknown as Value)
      await ctx.db.delete(snapshot._id)
      rowsDeleted++
    }

    console.info("Legacy snapshot purge batch", {
      rowsRead: snapshots.page.length,
      rowsDeleted,
      rowsSkipped,
      bytesDeleted,
      isDone: snapshots.isDone,
    })

    if (!snapshots.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.deletionCleanup.purgeLegacySnapshotRows,
        { cursor: snapshots.continueCursor }
      )
    }
  },
})

export const runDeletionBatch = internalMutation({
  args: { jobId: v.id("deletionJobs") },
  handler: (ctx, { jobId }) => runDeletionBatchImpl(ctx, jobId),
})

const STALLED_DELETION_JOB_AGE_MS = 5 * 60 * 1000
const STALLED_DELETION_JOB_LIMIT_PER_STATE = 8

export const reconcileStalledDeletionJobs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
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
    const stalled = [...pending, ...running]

    for (const job of stalled) {
      await ctx.db.patch(job._id, { updatedAt: now })
      await ctx.scheduler.runAfter(
        0,
        internal.deletionCleanup.runDeletionBatch,
        { jobId: job._id }
      )
    }

    console.info("Deletion job reconciliation", {
      pending: pending.length,
      running: running.length,
      scheduled: stalled.length,
    })
  },
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
