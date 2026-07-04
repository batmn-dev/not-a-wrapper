import { v } from "convex/values"
import type { Doc, Id } from "./_generated/dataModel"
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import {
  normalizeSelectedBranchPathForMutation,
  selectMessageSiblingForMutation,
} from "./domain/message_branch_writes"
import {
  getBranchInfoForMessage,
  getSelectedPathMessages,
} from "./domain/message_branches"
import {
  extractTextFromMessageParts,
  normalizeMessagePartsForStorage,
} from "./domain/message_parts"
import { isVisibleChatMessage } from "./domain/message_visibility"
import { getAuthorizedChatForRead, requireOwnedChat } from "./lib/auth"
import { ownedChatMutation } from "./lib/authedFunctions"

export { normalizeMessagePartsForStorage } from "./domain/message_parts"

async function getNextOrder(ctx: MutationCtx, chatId: Id<"chats">) {
  const latest = await ctx.db
    .query("messages")
    .withIndex("by_chat_order", (q) => q.eq("chatId", chatId))
    .order("desc")
    .first()
  return latest ? latest.orderId + 1 : 0
}

function withBranchMetadata(
  allMessages: Doc<"messages">[],
  selectedMessages: Doc<"messages">[]
) {
  return selectedMessages.map((message) => {
    const branch = getBranchInfoForMessage(allMessages, message)
    if (!branch) return message

    const metadata =
      message.metadata &&
      typeof message.metadata === "object" &&
      !Array.isArray(message.metadata)
        ? message.metadata
        : {}

    return {
      ...message,
      metadata: {
        ...metadata,
        branch,
      },
    }
  })
}

function getVisibleSelectedMessages(messages: Doc<"messages">[]) {
  return withBranchMetadata(
    messages,
    getSelectedPathMessages(messages).filter(isVisibleChatMessage)
  )
}

async function listMessagesByChatOrder(
  ctx: QueryCtx | MutationCtx,
  chatId: Id<"chats">
) {
  return await ctx.db
    .query("messages")
    .withIndex("by_chat_order", (q) => q.eq("chatId", chatId))
    .collect()
}

export async function getForChatHandler(
  ctx: QueryCtx,
  { chatId }: { chatId: Id<"chats"> }
) {
  const chat = await getAuthorizedChatForRead(ctx, chatId)
  if (!chat) return []

  const messages = await listMessagesByChatOrder(ctx, chatId)
  return getVisibleSelectedMessages(messages)
}

export async function getPublicForChatHandler(
  ctx: QueryCtx,
  { chatId }: { chatId: Id<"chats"> }
) {
  const chat = await ctx.db.get(chatId)
  if (!chat || !chat.public) return []

  const messages = await listMessagesByChatOrder(ctx, chatId)
  return getVisibleSelectedMessages(messages).filter(
    (message) => message.status !== "awaiting_approval"
  )
}

export async function getLastMessagesHandler(
  ctx: QueryCtx,
  { chatId, limit = 2 }: { chatId: Id<"chats">; limit?: number }
) {
  const chat = await getAuthorizedChatForRead(ctx, chatId)
  if (!chat) return []

  const messages = await listMessagesByChatOrder(ctx, chatId)
  return getVisibleSelectedMessages(messages).slice(-limit)
}

/**
 * Get all messages for a chat
 */
export const getForChat = query({
  args: { chatId: v.id("chats") },
  handler: getForChatHandler,
})

/**
 * Get messages for a public chat (no authentication required)
 * For public share pages
 */
export const getPublicForChat = query({
  args: { chatId: v.id("chats") },
  handler: getPublicForChatHandler,
})

/**
 * Get last N messages for a chat (for context)
 */
export const getLastMessages = query({
  args: {
    chatId: v.id("chats"),
    limit: v.optional(v.number()),
  },
  handler: getLastMessagesHandler,
})

/**
 * Select one sibling branch for rendering.
 */
export async function selectBranchForChat(
  ctx: MutationCtx,
  {
    chatId,
    messageId,
  }: {
    chatId: Id<"chats">
    messageId: Id<"messages">
  }
) {
  await requireOwnedChat(ctx, chatId)

  const targetMessage = await ctx.db.get(messageId)
  if (!targetMessage || targetMessage.chatId !== chatId) {
    throw new Error("Message not found")
  }

  let messages = await ctx.db
    .query("messages")
    .withIndex("by_chat_order", (q) => q.eq("chatId", chatId))
    .collect()
  const now = Date.now()

  messages = await normalizeSelectedBranchPathForMutation(ctx, messages, now)
  messages = await selectMessageSiblingForMutation(
    ctx,
    messages,
    targetMessage,
    now
  )
  await normalizeSelectedBranchPathForMutation(ctx, messages, now)

  await ctx.db.patch(chatId, { updatedAt: now })
  return targetMessage._id
}

export const selectBranch = mutation({
  args: {
    chatId: v.id("chats"),
    messageId: v.id("messages"),
  },
  handler: selectBranchForChat,
})

/**
 * Add a single message
 */
export const add = ownedChatMutation({
  args: {
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
    const user = ctx.user
    const chatId = ctx.chat._id

    // Update chat's updatedAt
    const now = Date.now()
    await ctx.db.patch(chatId, { updatedAt: now })
    const orderId = await getNextOrder(ctx, chatId)
    const parts = normalizeMessagePartsForStorage(args.parts, args.attachments)

    return await ctx.db.insert("messages", {
      chatId,
      orderId,
      clientMessageId: args.clientMessageId,
      userId: args.role === "user" ? user._id : undefined,
      role: args.role,
      content: args.content ?? extractTextFromMessageParts(parts),
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
export const addBatch = ownedChatMutation({
  args: {
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
  handler: async (ctx, { messages }) => {
    const user = ctx.user
    const chatId = ctx.chat._id

    // Update chat's updatedAt
    const now = Date.now()
    await ctx.db.patch(chatId, { updatedAt: now })

    // Insert all messages
    const ids = []
    let nextOrder = await getNextOrder(ctx, chatId)
    for (const msg of messages) {
      const parts = normalizeMessagePartsForStorage(msg.parts, msg.attachments)
      const id = await ctx.db.insert("messages", {
        chatId,
        orderId: nextOrder,
        clientMessageId: msg.clientMessageId,
        userId: msg.role === "user" ? user._id : undefined,
        role: msg.role,
        content: msg.content ?? extractTextFromMessageParts(parts),
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
 * Clear all messages for a chat
 */
export const clearForChat = ownedChatMutation({
  args: {},
  handler: async (ctx) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_chat", (q) => q.eq("chatId", ctx.chat._id))
      .collect()

    for (const msg of messages) {
      await ctx.db.delete(msg._id)
    }

    return messages.length
  },
})
