import { v } from "convex/values"
import { mutation, query } from "./_generated/server"

const DAILY_FILE_UPLOAD_LIMIT = 5

/**
 * Generate an upload URL for file storage
 * Enforces daily upload limit server-side
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    // Get user from database
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
      .unique()

    if (!user) throw new Error("User not found")

    // Enforce daily upload limit server-side
    const startOfDay = new Date()
    startOfDay.setUTCHours(0, 0, 0, 0)

    const attachments = await ctx.db
      .query("chatAttachments")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()

    const todayCount = attachments.filter(
      (a) => a._creationTime >= startOfDay.getTime()
    ).length

    if (todayCount >= DAILY_FILE_UPLOAD_LIMIT) {
      throw new Error(
        `Daily file upload limit reached (${DAILY_FILE_UPLOAD_LIMIT} files per day)`
      )
    }

    return await ctx.storage.generateUploadUrl()
  },
})

/**
 * Get a public URL for a stored file
 */
export const getUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    return await ctx.storage.getUrl(storageId)
  },
})

/**
 * Save file metadata after upload
 */
export const saveAttachment = mutation({
  args: {
    chatId: v.id("chats"),
    storageId: v.id("_storage"),
    fileName: v.optional(v.string()),
    fileType: v.optional(v.string()),
    fileSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
      .unique()

    if (!user) throw new Error("User not found")

    // Verify chat ownership before attaching file
    const chat = await ctx.db.get(args.chatId)
    if (!chat) throw new Error("Chat not found")
    if (chat.userId !== user._id) {
      throw new Error("Not authorized to attach files to this chat")
    }

    // Re-check daily upload limit to prevent bypass via pre-fetched upload URLs
    const startOfDay = new Date()
    startOfDay.setUTCHours(0, 0, 0, 0)

    const attachments = await ctx.db
      .query("chatAttachments")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()

    const todayCount = attachments.filter(
      (a) => a._creationTime >= startOfDay.getTime()
    ).length

    if (todayCount >= DAILY_FILE_UPLOAD_LIMIT) {
      // NOTE: We intentionally do NOT delete args.storageId here because we cannot
      // verify it belongs to this user. Deleting without ownership verification would
      // allow an attacker to delete other users' files by passing their storageId.
      // Orphaned files should be cleaned up by a scheduled background job.
      throw new Error(
        `Daily file upload limit reached (${DAILY_FILE_UPLOAD_LIMIT} files per day)`
      )
    }

    // Get the public URL
    const fileUrl = await ctx.storage.getUrl(args.storageId)
    if (!fileUrl) throw new Error("Failed to get file URL")

    return await ctx.db.insert("chatAttachments", {
      chatId: args.chatId,
      userId: user._id,
      storageId: args.storageId,
      fileUrl,
      fileName: args.fileName,
      fileType: args.fileType,
      fileSize: args.fileSize,
    })
  },
})

/**
 * Check daily file upload limit
 */
export const checkUploadLimit = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return { count: 0, limit: 5, canUpload: true }

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
      .unique()

    if (!user) return { count: 0, limit: 5, canUpload: true }

    // Get start of today (UTC)
    const startOfDay = new Date()
    startOfDay.setUTCHours(0, 0, 0, 0)

    const attachments = await ctx.db
      .query("chatAttachments")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()

    const todayCount = attachments.filter(
      (a) => a._creationTime >= startOfDay.getTime()
    ).length

    return {
      count: todayCount,
      limit: DAILY_FILE_UPLOAD_LIMIT,
      canUpload: todayCount < DAILY_FILE_UPLOAD_LIMIT,
    }
  },
})

/**
 * Delete a file
 */
export const deleteFile = mutation({
  args: { attachmentId: v.id("chatAttachments") },
  handler: async (ctx, { attachmentId }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const attachment = await ctx.db.get(attachmentId)
    if (!attachment) throw new Error("Attachment not found")

    // Verify ownership
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
      .unique()

    if (!user || attachment.userId !== user._id) {
      throw new Error("Not authorized")
    }

    // Delete from storage
    if (attachment.storageId) {
      await ctx.storage.delete(attachment.storageId)
    }

    // Delete metadata
    await ctx.db.delete(attachmentId)
  },
})
