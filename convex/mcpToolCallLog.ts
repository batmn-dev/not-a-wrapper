// Legacy duplicate with no callers; retained pending approved file deletion.

import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"
import { authenticatedMutation, maybeAuthQuery } from "./lib/authedFunctions"

// =============================================================================
// Helpers
// =============================================================================

const MAX_PREVIEW_LENGTH = 500

/**
 * Truncate a string to MAX_PREVIEW_LENGTH chars.
 * Intentionally stores only truncated previews — avoids persisting sensitive
 * data (PII, tokens) that MCP tools may process.
 */
function truncatePreview(text: string | undefined): string | undefined {
  if (!text) return undefined
  if (text.length <= MAX_PREVIEW_LENGTH) return text
  return text.slice(0, MAX_PREVIEW_LENGTH) + "…"
}

// =============================================================================
// Mutations
// =============================================================================

/**
 * Log a tool call for audit purposes.
 *
 * Called from the chat route's onFinish callback.
 * Truncates inputPreview and outputPreview to 500 chars.
 * userId is set from auth context — never from client input.
 */
export const log = authenticatedMutation({
  args: {
    chatId: v.optional(v.id("chats")),
    serverId: v.id("mcpServers"),
    toolName: v.string(),
    toolCallId: v.string(),
    inputPreview: v.optional(v.string()),
    outputPreview: v.optional(v.string()),
    success: v.boolean(),
    durationMs: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Verify chat ownership if chatId is provided
    if (args.chatId) {
      const chat = await ctx.db.get(args.chatId)
      if (!chat || chat.userId !== ctx.user._id) {
        throw new Error("Chat not found")
      }
    }

    return await ctx.db.insert("toolCallLog", {
      userId: ctx.user._id,
      chatId: args.chatId,
      serverId: args.serverId,
      toolName: args.toolName,
      toolCallId: args.toolCallId,
      inputPreview: truncatePreview(args.inputPreview),
      outputPreview: truncatePreview(args.outputPreview),
      success: args.success,
      durationMs: args.durationMs,
      error: args.error ? truncatePreview(args.error) : undefined,
      createdAt: Date.now(),
      source: "mcp" as const,
    })
  },
})

// =============================================================================
// Queries
// =============================================================================

/**
 * Get the audit trail for a specific conversation.
 * Returns all tool call log entries for the given chat, ordered by creation time.
 */
export const listByChat = maybeAuthQuery({
  args: { chatId: v.id("chats") },
  handler: async (ctx, { chatId }) => {
    const user = ctx.user
    if (!user) return []

    // Verify chat ownership
    const chat = await ctx.db.get(chatId)
    if (!chat || chat.userId !== user._id) return []

    return await ctx.db
      .query("toolCallLog")
      .withIndex("by_chat", (q) => q.eq("chatId", chatId))
      .order("desc")
      .collect()
  },
})

/**
 * Get the user's tool call history (paginated).
 * Returns most recent entries first.
 */
export const listByUser = maybeAuthQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const user = ctx.user
    if (!user) {
      return { page: [], isDone: true, continueCursor: "" }
    }

    return await ctx.db
      .query("toolCallLog")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .paginate(args.paginationOpts)
  },
})
