// convex/toolCallLog.ts
// Renamed from convex/mcpToolCallLog.ts — now logs all tool sources (builtin, third-party, mcp).

import { v } from "convex/values"
import { paginationOptsValidator } from "convex/server"
import { mutation, query } from "./_generated/server"

// =============================================================================
// Helpers
// =============================================================================

const MAX_PREVIEW_LENGTH = 500

/**
 * Truncate a string to MAX_PREVIEW_LENGTH chars.
 * Intentionally stores only truncated previews — avoids persisting sensitive
 * data (PII, tokens) that tools may process.
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
 * Supports all tool sources: builtin, third-party, and MCP.
 * serverId is optional — only provided for MCP tool calls.
 * userId is set from auth context — never from client input.
 */
export const log = mutation({
  args: {
    chatId: v.optional(v.id("chats")),
    serverId: v.optional(v.id("mcpServers")), // Only for MCP tools
    toolName: v.string(),
    toolCallId: v.string(),
    inputPreview: v.optional(v.string()),
    outputPreview: v.optional(v.string()),
    success: v.boolean(),
    durationMs: v.optional(v.number()),
    error: v.optional(v.string()),
    // REQUIRED — clean break, no backward compat needed
    source: v.union(
      v.literal("builtin"),
      v.literal("third-party"),
      v.literal("mcp"),
      v.literal("platform")
    ),
    serviceName: v.optional(v.string()),
    // Phase C: Observability enrichment
    stepNumber: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    resultSizeBytes: v.optional(v.number()),
    requestId: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    retryAfterSeconds: v.optional(v.number()),
    budgetKeyMode: v.optional(
      v.union(v.literal("platform"), v.literal("byok"))
    ),
    budgetDenied: v.optional(v.boolean()),
    // Payment guardrail observability (Phase 6)
    intentClass: v.optional(v.string()),
    policyDecision: v.optional(v.string()),
    chatVersion: v.optional(v.number()),
    toolKey: v.optional(v.string()),
    stateMutationKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
      .unique()

    if (!user) throw new Error("User not found")

    // Verify chat ownership if chatId is provided
    if (args.chatId) {
      const chat = await ctx.db.get(args.chatId)
      if (!chat || chat.userId !== user._id) {
        throw new Error("Chat not found")
      }
    }

    return await ctx.db.insert("toolCallLog", {
      userId: user._id,
      chatId: args.chatId,
      serverId: args.serverId,
      toolName: args.toolName,
      toolCallId: args.toolCallId,
      inputPreview: truncatePreview(args.inputPreview),
      outputPreview: truncatePreview(args.outputPreview),
      success: args.success,
      durationMs: args.durationMs,
      error: args.error ? truncatePreview(args.error) : undefined,
      source: args.source,
      serviceName: args.serviceName,
      // Phase C: Observability enrichment
      stepNumber: args.stepNumber,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      resultSizeBytes: args.resultSizeBytes,
      requestId: args.requestId,
      errorCode: args.errorCode,
      retryAfterSeconds: args.retryAfterSeconds,
      budgetKeyMode: args.budgetKeyMode,
      budgetDenied: args.budgetDenied,
      // Payment guardrail observability (Phase 6)
      intentClass: args.intentClass,
      policyDecision: args.policyDecision,
      chatVersion: args.chatVersion,
      toolKey: args.toolKey,
      stateMutationKey: args.stateMutationKey,
      createdAt: Date.now(),
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
export const listByChat = query({
  args: { chatId: v.id("chats") },
  handler: async (ctx, { chatId }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return []

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
      .unique()

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
export const listByUser = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      return { page: [], isDone: true, continueCursor: "" }
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
      .unique()

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
