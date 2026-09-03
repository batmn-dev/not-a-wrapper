import { v } from "convex/values"
import { redactSecretsInString } from "../lib/observability/secret-patterns"
import { findChatByPublicId, isChatActive } from "./lib/auth"
import { authenticatedMutation } from "./lib/authedFunctions"

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
    // Client-minted publicId (ADR-0033), resolved to the owned chat below.
    chatId: v.optional(v.string()),
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
    const chat = args.chatId
      ? await findChatByPublicId(ctx, args.chatId)
      : null
    if (args.chatId) {
      if (
        !chat ||
        chat.userId !== ctx.user._id ||
        !(await isChatActive(ctx, chat))
      ) {
        throw new Error("Chat not found")
      }
    }

    return await ctx.db.insert("toolCallLog", {
      userId: ctx.user._id,
      chatId: chat?._id,
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
