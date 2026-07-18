import { v } from "convex/values"
import { internalMutation, internalQuery } from "./_generated/server"
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

/**
 * Production-safe backfill for the initially optional activity timestamp.
 * Existing projects start at the later of their creation time and newest chat
 * activity, so deploying the field never labels legacy rows as modified "now".
 */
export const backfillUpdatedAt = internalMutation({
  args: {},
  handler: async (ctx) => {
    const projects = await ctx.db.query("projects").collect()
    let patched = 0

    for (const project of projects) {
      const newestChat = await ctx.db
        .query("chats")
        .withIndex("by_project_updated", (q) =>
          q.eq("projectId", project._id)
        )
        .order("desc")
        .first()
      const updatedAt = Math.max(
        getProjectModifiedAt(project),
        newestChat?.updatedAt ?? project._creationTime
      )

      if (project.updatedAt !== updatedAt) {
        await ctx.db.patch(project._id, { updatedAt })
        patched++
      }
    }

    return { total: projects.length, patched }
  },
})

/**
 * Delete a project and its associated chats
 */
export const remove = ownedProjectMutation({
  args: {},
  handler: async (ctx) => {
    const projectId = ctx.project._id
    // Get all chats for this project
    const chats = await ctx.db
      .query("chats")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect()

    // Delete all messages and attachments for each chat
    for (const chat of chats) {
      const messages = await ctx.db
        .query("messages")
        .withIndex("by_chat", (q) => q.eq("chatId", chat._id))
        .collect()

      for (const message of messages) {
        await ctx.db.delete(message._id)
      }

      const attachments = await ctx.db
        .query("chatAttachments")
        .withIndex("by_chat", (q) => q.eq("chatId", chat._id))
        .collect()

      for (const attachment of attachments) {
        if (attachment.storageId) {
          await ctx.storage.delete(attachment.storageId)
        }
        await ctx.db.delete(attachment._id)
      }

      await ctx.db.delete(chat._id)
    }

    // Delete the project
    await ctx.db.delete(projectId)
  },
})
