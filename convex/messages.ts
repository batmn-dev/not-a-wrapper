import { v } from "convex/values"
import { mutation, query } from "./_generated/server"

/**
 * Get all messages for a chat
 */
export const getForChat = query({
  args: { chatId: v.id("chats") },
  handler: async (ctx, { chatId }) => {
    // Verify chat access
    const chat = await ctx.db.get(chatId)
    if (!chat) return []

    const identity = await ctx.auth.getUserIdentity()

    // Check ownership or public access
    if (!chat.public) {
      if (!identity) return []

      const user = await ctx.db
        .query("users")
        .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
        .unique()

      if (!user || chat.userId !== user._id) return []
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_chat", (q) => q.eq("chatId", chatId))
      .collect()

    // Sort by creation time
    return messages.sort((a, b) => a._creationTime - b._creationTime)
  },
})

/**
 * Get messages for a public chat (no authentication required)
 * For public share pages
 */
export const getPublicForChat = query({
  args: { chatId: v.id("chats") },
  handler: async (ctx, { chatId }) => {
    // Verify chat exists and is public
    const chat = await ctx.db.get(chatId)
    if (!chat || !chat.public) return []

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_chat", (q) => q.eq("chatId", chatId))
      .collect()

    // Sort by creation time
    return messages.sort((a, b) => a._creationTime - b._creationTime)
  },
})

/**
 * Get last N messages for a chat (for context)
 */
export const getLastMessages = query({
  args: {
    chatId: v.id("chats"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { chatId, limit = 2 }) => {
    // Verify chat access (same checks as getForChat)
    const chat = await ctx.db.get(chatId)
    if (!chat) return []

    const identity = await ctx.auth.getUserIdentity()

    // Check ownership or public access
    if (!chat.public) {
      if (!identity) return []

      const user = await ctx.db
        .query("users")
        .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
        .unique()

      if (!user || chat.userId !== user._id) return []
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_chat", (q) => q.eq("chatId", chatId))
      .collect()

    // Sort by creation time desc and take last N
    return messages
      .sort((a, b) => b._creationTime - a._creationTime)
      .slice(0, limit)
      .reverse()
  },
})

/**
 * Add a single message
 */
export const add = mutation({
  args: {
    chatId: v.id("chats"),
    role: v.union(
      v.literal("user"),
      v.literal("assistant"),
      v.literal("system"),
      v.literal("data")
    ),
    content: v.optional(v.string()),
    parts: v.optional(v.any()),
    attachments: v.optional(v.array(v.any())),
    messageGroupId: v.optional(v.string()),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Verify chat exists and user has access
    const chat = await ctx.db.get(args.chatId)
    if (!chat) throw new Error("Chat not found")

    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
      .unique()

    if (!user || chat.userId !== user._id) {
      throw new Error("Not authorized")
    }

    // Idempotency guard: prevent duplicate messages from race conditions.
    // In multi-model chat, concurrent streams finishing near-simultaneously
    // can cause the same logical message to be inserted twice (different client
    // IDs, same messageGroupId + model + role). Check before inserting.
    if (args.messageGroupId) {
      const existing = await ctx.db
        .query("messages")
        .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
        .filter((q) =>
          q.and(
            q.eq(q.field("messageGroupId"), args.messageGroupId),
            q.eq(q.field("role"), args.role),
            // For user messages, dedupe by groupId+role alone (only one user msg per group).
            // For assistant messages, also match on model (one response per model per group).
            args.model
              ? q.eq(q.field("model"), args.model)
              : true,
          )
        )
        .first()

      if (existing) return existing._id
    }

    // Update chat's updatedAt
    await ctx.db.patch(args.chatId, { updatedAt: Date.now() })

    return await ctx.db.insert("messages", {
      chatId: args.chatId,
      userId: args.role === "user" ? user._id : undefined,
      role: args.role,
      content: args.content,
      parts: args.parts,
      attachments: args.attachments,
      messageGroupId: args.messageGroupId,
      model: args.model,
    })
  },
})

/**
 * Add multiple messages at once
 */
export const addBatch = mutation({
  args: {
    chatId: v.id("chats"),
    messages: v.array(
      v.object({
        role: v.union(
          v.literal("user"),
          v.literal("assistant"),
          v.literal("system"),
          v.literal("data")
        ),
        content: v.optional(v.string()),
        parts: v.optional(v.any()),
        attachments: v.optional(v.array(v.any())),
        messageGroupId: v.optional(v.string()),
        model: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, { chatId, messages }) => {
    const chat = await ctx.db.get(chatId)
    if (!chat) throw new Error("Chat not found")

    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
      .unique()

    if (!user || chat.userId !== user._id) {
      throw new Error("Not authorized")
    }

    // Update chat's updatedAt
    await ctx.db.patch(chatId, { updatedAt: Date.now() })

    // Insert all messages
    const ids = []
    for (const msg of messages) {
      const id = await ctx.db.insert("messages", {
        chatId,
        userId: msg.role === "user" ? user._id : undefined,
        role: msg.role,
        content: msg.content,
        parts: msg.parts,
        attachments: msg.attachments,
        messageGroupId: msg.messageGroupId,
        model: msg.model,
      })
      ids.push(id)
    }

    return ids
  },
})

/**
 * Delete messages from a specific timestamp (for edit functionality)
 */
export const deleteFromTimestamp = mutation({
  args: {
    chatId: v.id("chats"),
    timestamp: v.number(),
  },
  handler: async (ctx, { chatId, timestamp }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    // Verify chat exists and user owns it
    const chat = await ctx.db.get(chatId)
    if (!chat) throw new Error("Chat not found")

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
      .unique()

    if (!user || chat.userId !== user._id) {
      throw new Error("Not authorized")
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_chat", (q) => q.eq("chatId", chatId))
      .collect()

    const toDelete = messages.filter((m) => m._creationTime >= timestamp)
    const remainingMessageCount = messages.length - toDelete.length
    // Mirror client-side version semantics so server-side truncation can safely
    // clean payment state even when sourceMessageTimestamp is unavailable.
    const truncationMinVersion = remainingMessageCount + 1

    for (const msg of toDelete) {
      await ctx.db.delete(msg._id)
    }

    return toDelete.length
  },
})

/**
 * Clear all messages for a chat
 */
export const clearForChat = mutation({
  args: { chatId: v.id("chats") },
  handler: async (ctx, { chatId }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const chat = await ctx.db.get(chatId)
    if (!chat) throw new Error("Chat not found")

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
      .unique()

    if (!user || chat.userId !== user._id) {
      throw new Error("Not authorized")
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_chat", (q) => q.eq("chatId", chatId))
      .collect()

    for (const msg of messages) {
      await ctx.db.delete(msg._id)
    }

    return messages.length
  },
})
