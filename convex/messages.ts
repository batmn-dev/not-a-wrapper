import { v } from "convex/values"
import { mutation, query, type MutationCtx } from "./_generated/server"
import type { Id } from "./_generated/dataModel"
import { getAuthorizedChatForRead, requireOwnedChat } from "./lib/auth"

function extractTextFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return ""
  let text = ""
  for (const part of parts) {
    if (
      part &&
      typeof part === "object" &&
      (part as { type?: unknown }).type === "text" &&
      typeof (part as { text?: unknown }).text === "string"
    ) {
      text += (part as { text: string }).text
    }
  }
  return text
}

type StoredAttachment = {
  name: string
  contentType: string
  url: string
}

function normalizeStoredAttachments(attachments: unknown): StoredAttachment[] {
  if (!Array.isArray(attachments)) return []

  return attachments
    .map((attachment) => {
      if (!attachment || typeof attachment !== "object") return null

      const record = attachment as {
        name?: unknown
        contentType?: unknown
        url?: unknown
      }

      if (typeof record.url !== "string" || record.url.length === 0) {
        return null
      }

      return {
        name:
          typeof record.name === "string" && record.name.length > 0
            ? record.name
            : "file",
        contentType:
          typeof record.contentType === "string" &&
          record.contentType.length > 0
            ? record.contentType
            : "application/octet-stream",
        url: record.url,
      }
    })
    .filter((attachment): attachment is StoredAttachment => Boolean(attachment))
}

export function normalizeMessagePartsForStorage(
  parts: unknown,
  attachments?: unknown
): unknown {
  const baseParts = parts === undefined ? [] : parts
  if (!Array.isArray(baseParts)) return baseParts

  const storedAttachments = normalizeStoredAttachments(attachments)
  if (storedAttachments.length === 0) return baseParts

  const hasFileParts = baseParts.some(
    (part) =>
      part &&
      typeof part === "object" &&
      (part as { type?: unknown }).type === "file"
  )
  if (hasFileParts) return baseParts

  return [
    ...baseParts,
    ...storedAttachments.map((attachment) => ({
      type: "file" as const,
      filename: attachment.name,
      mediaType: attachment.contentType,
      url: attachment.url,
    })),
  ]
}

async function getNextOrder(ctx: MutationCtx, chatId: Id<"chats">) {
  const latest = await ctx.db
    .query("messages")
    .withIndex("by_chat_order", (q) => q.eq("chatId", chatId))
    .order("desc")
    .first()
  return latest ? latest.orderId + 1 : 0
}

/**
 * Get all messages for a chat
 */
export const getForChat = query({
  args: { chatId: v.id("chats") },
  handler: async (ctx, { chatId }) => {
    const chat = await getAuthorizedChatForRead(ctx, chatId)
    if (!chat) return []

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_chat_order", (q) => q.eq("chatId", chatId))
      .collect()

    return messages
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
      .withIndex("by_chat_order", (q) => q.eq("chatId", chatId))
      .collect()

    return messages.filter((message) => message.status !== "awaiting_approval")
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
    const chat = await getAuthorizedChatForRead(ctx, chatId)
    if (!chat) return []

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_chat_order", (q) => q.eq("chatId", chatId))
      .order("desc")
      .take(limit)

    return messages.reverse()
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
    clientMessageId: v.optional(v.string()),
    content: v.optional(v.string()),
    parts: v.optional(v.any()),
    attachments: v.optional(v.array(v.any())),
  },
  handler: async (ctx, args) => {
    const { user } = await requireOwnedChat(ctx, args.chatId)

    // Update chat's updatedAt
    const now = Date.now()
    await ctx.db.patch(args.chatId, { updatedAt: now })
    const orderId = await getNextOrder(ctx, args.chatId)
    const parts = normalizeMessagePartsForStorage(
      args.parts,
      args.attachments
    )

    return await ctx.db.insert("messages", {
      chatId: args.chatId,
      orderId,
      clientMessageId: args.clientMessageId,
      userId: args.role === "user" ? user._id : undefined,
      role: args.role,
      content: args.content ?? extractTextFromParts(parts),
      parts,
      status: "completed",
      createdAt: now,
      updatedAt: now,
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
        clientMessageId: v.optional(v.string()),
        content: v.optional(v.string()),
        parts: v.optional(v.any()),
        attachments: v.optional(v.array(v.any())),
      })
    ),
  },
  handler: async (ctx, { chatId, messages }) => {
    const { user } = await requireOwnedChat(ctx, chatId)

    // Update chat's updatedAt
    const now = Date.now()
    await ctx.db.patch(chatId, { updatedAt: now })

    // Insert all messages
    const ids = []
    let nextOrder = await getNextOrder(ctx, chatId)
    for (const msg of messages) {
      const parts = normalizeMessagePartsForStorage(
        msg.parts,
        msg.attachments
      )
      const id = await ctx.db.insert("messages", {
        chatId,
        orderId: nextOrder,
        clientMessageId: msg.clientMessageId,
        userId: msg.role === "user" ? user._id : undefined,
        role: msg.role,
        content: msg.content ?? extractTextFromParts(parts),
        parts,
        status: "completed",
        createdAt: now,
        updatedAt: now,
      })
      ids.push(id)
      nextOrder += 1
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

    const toDelete = messages.filter((m) => m.createdAt >= timestamp)
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
