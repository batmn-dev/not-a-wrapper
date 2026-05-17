import { v } from "convex/values"
import { internalQuery, mutation, query } from "./_generated/server"

/**
 * Get all projects for the current user
 */
export const getForCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return []

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
      .unique()

    if (!user) return []

    return await ctx.db
      .query("projects")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()
  },
})

/**
 * Get a single project by ID with ownership verification
 */
export const getById = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId)
    if (!project) return null

    // Verify ownership
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return null

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
      .unique()

    if (!user || project.userId !== user._id) {
      return null
    }

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
export const create = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, { name }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
      .unique()

    if (!user) throw new Error("User not found")

    return await ctx.db.insert("projects", {
      userId: user._id,
      name,
    })
  },
})

/**
 * Update a project name
 */
export const updateName = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
  },
  handler: async (ctx, { projectId, name }) => {
    const project = await ctx.db.get(projectId)
    if (!project) throw new Error("Project not found")

    // Verify ownership
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
      .unique()

    if (!user || project.userId !== user._id) {
      throw new Error("Not authorized")
    }

    await ctx.db.patch(projectId, { name })
  },
})

/**
 * Delete a project and its associated chats
 */
export const remove = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId)
    if (!project) throw new Error("Project not found")

    // Verify ownership
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
      .unique()

    if (!user || project.userId !== user._id) {
      throw new Error("Not authorized")
    }

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
