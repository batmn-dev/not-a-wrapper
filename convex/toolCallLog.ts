import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"
import { redactSecretsInString } from "../lib/observability/secret-patterns"
import { authenticatedMutation, maybeAuthQuery } from "./lib/authedFunctions"

const MAX_PREVIEW_LENGTH = 500

/**
 * Store bounded previews to limit persistence of sensitive tool data.
 */
function preparePreviewForPersistence(
  text: string | undefined
): string | undefined {
  if (!text) return undefined
  const redacted = redactSecretsInString(text)
  if (redacted.length <= MAX_PREVIEW_LENGTH) return redacted
  return redacted.slice(0, MAX_PREVIEW_LENGTH) + "…"
}

/**
 * Log a tool call for audit purposes.
 *
 * User identity comes from auth; clients cannot select the audit owner.
 */
export const log = authenticatedMutation({
  args: {
    chatId: v.optional(v.id("chats")),
    serverId: v.optional(v.id("mcpServers")),
    toolName: v.string(),
    toolCallId: v.string(),
    inputPreview: v.optional(v.string()),
    outputPreview: v.optional(v.string()),
    success: v.boolean(),
    durationMs: v.optional(v.number()),
    error: v.optional(v.string()),
    // Unresolved tool names are audited instead of silently skipped.
    source: v.union(
      v.literal("builtin"),
      v.literal("third-party"),
      v.literal("mcp"),
      v.literal("platform"),
      v.literal("unknown")
    ),
    serviceName: v.optional(v.string()),
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
    intentClass: v.optional(v.string()),
    policyDecision: v.optional(v.string()),
    chatVersion: v.optional(v.number()),
    toolKey: v.optional(v.string()),
    stateMutationKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.chatId) {
      const chat = await ctx.db.get(args.chatId)
      if (
        !chat ||
        chat.userId !== ctx.user._id ||
        chat.deletingAt !== undefined
      ) {
        throw new Error("Chat not found")
      }
    }

    return await ctx.db.insert("toolCallLog", {
      userId: ctx.user._id,
      chatId: args.chatId,
      serverId: args.serverId,
      toolName: args.toolName,
      toolCallId: args.toolCallId,
      inputPreview: preparePreviewForPersistence(args.inputPreview),
      outputPreview: preparePreviewForPersistence(args.outputPreview),
      success: args.success,
      durationMs: args.durationMs,
      error: preparePreviewForPersistence(args.error),
      source: args.source,
      serviceName: args.serviceName,
      stepNumber: args.stepNumber,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      resultSizeBytes: args.resultSizeBytes,
      requestId: args.requestId,
      errorCode: args.errorCode,
      retryAfterSeconds: args.retryAfterSeconds,
      budgetKeyMode: args.budgetKeyMode,
      budgetDenied: args.budgetDenied,
      intentClass: args.intentClass,
      policyDecision: args.policyDecision,
      chatVersion: args.chatVersion,
      toolKey: args.toolKey,
      stateMutationKey: args.stateMutationKey,
      createdAt: Date.now(),
    })
  },
})

/** Return a conversation's newest-first tool audit trail to its owner. */
export const listByChat = maybeAuthQuery({
  args: { chatId: v.id("chats") },
  handler: async (ctx, { chatId }) => {
    const user = ctx.user
    if (!user) return []

    const chat = await ctx.db.get(chatId)
    if (!chat || chat.userId !== user._id || chat.deletingAt !== undefined) {
      return []
    }

    return await ctx.db
      .query("toolCallLog")
      .withIndex("by_chat", (q) => q.eq("chatId", chatId))
      .order("desc")
      .collect()
  },
})

/** Return the current user's newest-first paginated tool history. */
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
