import { v } from "convex/values"
import { internal } from "./_generated/api"
import type { Doc } from "./_generated/dataModel"
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server"
import { ensureProjectDeletionJob } from "./domain/chat_deletion"
import { newestLinkedChat } from "./domain/chat_project_link"
import {
  getProjectModifiedAt,
  patchProjectActivity,
} from "./domain/project_activity"
import {
  authenticatedMutation,
  maybeAuthQuery,
  ownedProjectMutation,
} from "./lib/authedFunctions"

/**
 * Get all projects for the current user
 */
export const getForCurrentUser = maybeAuthQuery({
  args: {},
  handler: async (ctx) => {
    const user = ctx.user
    if (!user) return []

    return await ctx.db
      .query("projects")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => q.eq(q.field("deletingAt"), undefined))
      .collect()
  },
})

/**
 * Get a single project by ID. Returns the project only when the authenticated
 * caller owns it; otherwise null (no public-project concept).
 */
export const getById = maybeAuthQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId)
    if (!project) return null
    if (!ctx.user || project.userId !== ctx.user._id) return null
    if (project.deletingAt !== undefined) return null
    return project
  },
})

/**
 * Get a project by ID without auth (internal use only)
 * Returns project with userId for ownership comparison
 *
 * SECURITY: This is an internalQuery - not accessible from clients.
 * Use getById for client-facing queries with ownership verification.
 */
export const getByIdWithOwner = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId)
    if (!project) return null
    if (project.deletingAt !== undefined) return null

    // Get the owner's WorkOS user ID for ownership verification
    const owner = await ctx.db.get(project.userId)
    if (!owner) return null

    return {
      ...project,
      ownerWorkosUserId: owner.workosUserId,
    }
  },
})

/**
 * Create a new project
 */
export const create = authenticatedMutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, { name }) => {
    const now = Date.now()
    return await ctx.db.insert("projects", {
      userId: ctx.user._id,
      name,
      updatedAt: now,
    })
  },
})

/**
 * Update a project name
 */
export const updateName = ownedProjectMutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    if (ctx.project.name === name) return
    await patchProjectActivity(ctx, ctx.project, { name }, Date.now())
  },
})

/**
 * Pin or unpin a project. `ownedProjectMutation` authenticates the caller and
 * verifies ownership before this handler can patch the document.
 */
export const togglePinned = ownedProjectMutation({
  args: { pinned: v.boolean() },
  handler: async (ctx, { pinned }) => {
    if (Boolean(ctx.project.pinned) === pinned) return
    await patchProjectActivity(ctx, ctx.project, { pinned }, Date.now())
  },
})

const PROJECT_BACKFILL_PAGE_SIZE = 50

type BackfillUpdatedAtArgs = {
  cursor?: string
  total?: number
  patched?: number
}

type BackfillUpdatedAtResult = {
  isDone: boolean
  total: number
  patched: number
}

export async function backfillUpdatedAtBatch(
  ctx: MutationCtx,
  { cursor, total = 0, patched = 0 }: BackfillUpdatedAtArgs
): Promise<BackfillUpdatedAtResult> {
  const projects = await ctx.db.query("projects").paginate({
    cursor: cursor ?? null,
    numItems: PROJECT_BACKFILL_PAGE_SIZE,
  })
  let batchPatched = 0

  for (const project of projects.page) {
    if (project.deletingAt !== undefined) continue
    const newestChat = await newestLinkedChat(ctx, project)
    const updatedAt = Math.max(
      getProjectModifiedAt(project),
      newestChat?.updatedAt ?? project._creationTime
    )

    if (project.updatedAt !== updatedAt) {
      await ctx.db.patch(project._id, { updatedAt })
      batchPatched++
    }
  }

  const nextTotal = total + projects.page.length
  const nextPatched = patched + batchPatched

  if (!projects.isDone) {
    await ctx.scheduler.runAfter(0, internal.projects.backfillUpdatedAt, {
      cursor: projects.continueCursor,
      total: nextTotal,
      patched: nextPatched,
    })
  }

  return {
    isDone: projects.isDone,
    total: nextTotal,
    patched: nextPatched,
  }
}

/**
 * Production-safe backfill for the initially optional activity timestamp.
 * Existing projects start at the later of their creation time and newest chat
 * activity, so deploying the field never labels legacy rows as modified "now".
 * Each page schedules the next one after committing to stay within transaction
 * limits while preserving cumulative progress counts.
 */
export const backfillUpdatedAt = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    total: v.optional(v.number()),
    patched: v.optional(v.number()),
  },
  handler: backfillUpdatedAtBatch,
})

export async function removeProjectForOwner(
  ctx: MutationCtx & { project: Doc<"projects">; user: Doc<"users"> }
): Promise<void> {
  const now = Date.now()
  await ctx.db.patch(ctx.project._id, {
    deletingAt: now,
    updatedAt: now,
  })
  const job = await ensureProjectDeletionJob(ctx, ctx.project, ctx.user)
  await ctx.scheduler.runAfter(
    0,
    internal.deletionCleanup.runDeletionBatch,
    {
      jobId: job._id,
    }
  )
}

/** Logically delete a Project and schedule its bounded physical drain. */
export const remove = ownedProjectMutation({
  args: {},
  handler: async (ctx) => removeProjectForOwner(ctx),
})
