import { v } from "convex/values"
import { mutation, query } from "./_generated/server"
import {
  getAuthorizedChatForRead,
  getCurrentUser,
  requireCurrentUser,
  requireOwnedChat,
  requireOwnedProject,
} from "./lib/auth"

/**
 * Get all chats for the current user
 */
export const getForCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []

    const chats = await ctx.db
      .query("chats")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()

    // Sort: pinned first (by pinnedAt desc), then by updatedAt/createdAt desc
    return chats.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1
      if (!a.pinned && b.pinned) return 1
      if (a.pinned && b.pinned) {
        return (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0)
      }
      const aTime = a.updatedAt ?? a._creationTime
      const bTime = b.updatedAt ?? b._creationTime
      return bTime - aTime
    })
  },
})

/**
 * Get a single chat by ID
 * Returns the chat if:
 * - The chat is public (no auth required), OR
 * - The user is authenticated and owns the chat
 */
export const getById = query({
  args: { chatId: v.id("chats") },
  handler: async (ctx, { chatId }) => {
    return await getAuthorizedChatForRead(ctx, chatId)
  },
})

/**
 * Create a new chat
 */
export const create = mutation({
  args: {
    title: v.optional(v.string()),
    model: v.optional(v.string()),
    systemPrompt: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx)
    if (args.projectId) {
      await requireOwnedProject(ctx, args.projectId)
    }

    return await ctx.db.insert("chats", {
      userId: user._id,
      title: args.title ?? "New chat",
      model: args.model,
      systemPrompt: args.systemPrompt,
      projectId: args.projectId,
      public: false,
      pinned: false,
      updatedAt: Date.now(),
    })
  },
})

/**
 * Update chat title
 */
export const updateTitle = mutation({
  args: {
    chatId: v.id("chats"),
    title: v.string(),
  },
  handler: async (ctx, { chatId, title }) => {
    await requireOwnedChat(ctx, chatId)

    await ctx.db.patch(chatId, { title, updatedAt: Date.now() })
  },
})

/**
 * Update chat model
 */
export const updateModel = mutation({
  args: {
    chatId: v.id("chats"),
    model: v.string(),
  },
  handler: async (ctx, { chatId, model }) => {
    await requireOwnedChat(ctx, chatId)

    await ctx.db.patch(chatId, { model, updatedAt: Date.now() })
  },
})

/**
 * Toggle chat pin status
 */
export const togglePin = mutation({
  args: {
    chatId: v.id("chats"),
    pinned: v.boolean(),
  },
  handler: async (ctx, { chatId, pinned }) => {
    await requireOwnedChat(ctx, chatId)

    await ctx.db.patch(chatId, {
      pinned,
      pinnedAt: pinned ? Date.now() : undefined,
      updatedAt: Date.now(),
    })
  },
})

/**
 * Make a chat public (shareable via link)
 */
export const makePublic = mutation({
  args: { chatId: v.id("chats") },
  handler: async (ctx, { chatId }) => {
    await requireOwnedChat(ctx, chatId)

    await ctx.db.patch(chatId, { public: true, updatedAt: Date.now() })
  },
})

/**
 * Get a public chat by ID (no authentication required)
 * For public share pages
 */
export const getPublicById = query({
  args: { chatId: v.id("chats") },
  handler: async (ctx, { chatId }) => {
    const chat = await ctx.db.get(chatId)
    if (!chat) return null

    // Only return if chat is public
    if (!chat.public) return null

    return chat
  },
})

/**
 * Delete a chat and its messages
 */
export const remove = mutation({
  args: { chatId: v.id("chats") },
  handler: async (ctx, { chatId }) => {
    await requireOwnedChat(ctx, chatId)

    // Delete all messages for this chat
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_chat", (q) => q.eq("chatId", chatId))
      .collect()

    for (const message of messages) {
      await ctx.db.delete(message._id)
    }

    // Delete all attachments for this chat
    const attachments = await ctx.db
      .query("chatAttachments")
      .withIndex("by_chat", (q) => q.eq("chatId", chatId))
      .collect()

    for (const attachment of attachments) {
      // Delete from storage if exists
      if (attachment.storageId) {
        await ctx.storage.delete(attachment.storageId)
      }
      await ctx.db.delete(attachment._id)
    }

    // Delete the chat
    await ctx.db.delete(chatId)
  },
})
