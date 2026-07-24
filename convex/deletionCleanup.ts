import { getConvexSize, v, type Value } from "convex/values"
import { internal } from "./_generated/api"
import { internalMutation } from "./_generated/server"
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
