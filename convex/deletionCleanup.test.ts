import { describe, expect, it, vi } from "vitest"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx } from "./_generated/server"
import { reconcileStalledDeletionJobsHandler } from "./deletionCleanup"

function asId<Table extends "users" | "chats" | "deletionJobs">(
  value: string
): Id<Table> {
  return value as Id<Table>
}

function deletionJob(
  id: string,
  state: Doc<"deletionJobs">["state"],
  updatedAt: number
): Doc<"deletionJobs"> {
  return {
    _id: asId<"deletionJobs">(id),
    _creationTime: 1,
    targetKind: "chat",
    chatId: asId<"chats">(`chat-${id}`),
    userId: asId<"users">("user-1"),
    state,
    phase: "snapshots",
    version: 1,
    batchesProcessed: 0,
    documentsDeleted: 0,
    bytesObserved: 0,
    retryCount: 0,
    createdAt: 1,
    updatedAt,
  }
}

function createCtx(jobs: Doc<"deletionJobs">[]) {
  const patches: Array<{ id: string; updatedAt: number }> = []
  const scheduled: Array<{ delay: number; jobId: string }> = []
  const ctx = {
    db: {
      query: (tableName: string) => {
        expect(tableName).toBe("deletionJobs")
        const filters = new Map<string, unknown>()
        let updatedAtBefore: number | undefined
        const query = {
          eq: (fieldName: string, value: unknown) => {
            filters.set(fieldName, value)
            return query
          },
          lt: (fieldName: string, value: number) => {
            expect(fieldName).toBe("updatedAt")
            updatedAtBefore = value
            return query
          },
        }
        return {
          withIndex: (
            indexName: string,
            buildQuery: (queryBuilder: typeof query) => unknown
          ) => {
            expect(indexName).toBe("by_state_updated")
            buildQuery(query)
            return {
              take: async (limit: number) =>
                jobs
                  .filter((job) => {
                    for (const [fieldName, value] of filters) {
                      if (
                        (job as unknown as Record<string, unknown>)[
                          fieldName
                        ] !== value
                      ) {
                        return false
                      }
                    }
                    return (
                      updatedAtBefore === undefined ||
                      job.updatedAt < updatedAtBefore
                    )
                  })
                  .slice(0, limit),
            }
          },
        }
      },
      patch: async (
        id: Id<"deletionJobs">,
        value: { updatedAt: number }
      ) => {
        patches.push({ id: id as string, updatedAt: value.updatedAt })
      },
    },
    scheduler: {
      runAfter: async (
        delay: number,
        _functionReference: unknown,
        args: { jobId: Id<"deletionJobs"> }
      ) => {
        scheduled.push({ delay, jobId: args.jobId as string })
        return "scheduled"
      },
    },
  } as unknown as Pick<MutationCtx, "db" | "scheduler">

  return { ctx, patches, scheduled }
}

describe("reconcileStalledDeletionJobsHandler", () => {
  it("reschedules only stale recoverable jobs and reports blocked jobs", async () => {
    const now = 1_000_000
    const stale = now - 5 * 60 * 1000 - 1
    const fresh = now - 5 * 60 * 1000
    const jobs = [
      deletionJob("pending-stale", "pending", stale),
      deletionJob("pending-fresh", "pending", fresh),
      deletionJob("running-stale", "running", stale),
      deletionJob("blocked", "blocked", 1),
      deletionJob("complete", "complete", 1),
    ]
    const { ctx, patches, scheduled } = createCtx(jobs)
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined)

    await expect(
      reconcileStalledDeletionJobsHandler(ctx, now)
    ).resolves.toEqual({
      pending: 1,
      running: 1,
      scheduled: 2,
      blockedObserved: 1,
      blockedCountMayBeCapped: false,
    })
    expect(patches).toEqual([
      { id: "pending-stale", updatedAt: now },
      { id: "running-stale", updatedAt: now },
    ])
    expect(scheduled).toEqual([
      { delay: 0, jobId: "pending-stale" },
      { delay: 0, jobId: "running-stale" },
    ])
    expect(info).toHaveBeenCalledWith("Deletion job reconciliation", {
      pending: 1,
      running: 1,
      scheduled: 2,
      blockedObserved: 1,
      blockedCountMayBeCapped: false,
    })
  })
})
