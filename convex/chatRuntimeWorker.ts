import { v } from "convex/values"
import type { Doc, Id } from "./_generated/dataModel"
import { internalMutation, type MutationCtx } from "./_generated/server"
import {
  createToolApprovalRequestForChat,
  markGenerationRunAbortedForChat,
  markGenerationRunCompletedForChat,
  markGenerationRunFailedForChat,
  recordToolInvocationsForChat,
  updateAssistantSnapshotForChat,
} from "./chatRuntime"
import type { AuthenticatedRunOwner } from "./lib/auth"
import { timingSafeEqualHex } from "./lib/sha256"
import { vToolInvocationStreamMetadata } from "./lib/messageMetadata"

// ---------------------------------------------------------------------------
// Chat-turn worker mutations (ADR-0011): the execution-grant half of durable
// settlement. The /chat-turn/worker HTTP action authenticates a Bearer secret
// by digest and dispatches here; each mutation re-verifies the grant against
// the run row transactionally, reconstructs the same `AuthenticatedRunOwner`
// the user-token wrappers inject, and reuses the `...ForChat` handlers — one
// policy, two authenticators. The raw secret never appears in mutation
// arguments; only its digest does, and internal mutations are unreachable
// from clients.
// ---------------------------------------------------------------------------

const vToolSource = v.union(
  v.literal("builtin"),
  v.literal("third-party"),
  v.literal("mcp"),
  v.literal("platform")
)

const vToolInvocationStatus = v.union(
  v.literal("called"),
  v.literal("pending_approval"),
  v.literal("approved"),
  v.literal("denied"),
  v.literal("completed"),
  v.literal("failed")
)

const grantArgs = {
  runId: v.id("generationRuns"),
  grantDigest: v.string(),
}

/**
 * Resolve the run an execution grant authorizes, or throw. All failure shapes
 * collapse to the same message so a probing caller cannot distinguish a
 * missing run from a wrong digest; expiry is reported distinctly because the
 * legitimate worker needs to tell them apart in telemetry.
 */
export async function requireGrantAuthorizedRun(
  ctx: MutationCtx,
  args: { runId: Id<"generationRuns">; grantDigest: string }
): Promise<AuthenticatedRunOwner> {
  const run = await ctx.db.get(args.runId)
  if (
    !run ||
    !run.grantDigest ||
    !timingSafeEqualHex(run.grantDigest, args.grantDigest)
  ) {
    throw new Error("Execution grant not authorized")
  }
  if (!run.grantExpiresAt || run.grantExpiresAt <= Date.now()) {
    throw new Error("Execution grant expired")
  }

  const chat = await ctx.db.get(run.chatId)
  if (!chat) throw new Error("Execution grant not authorized")
  const user = run.userId ? await ctx.db.get(run.userId) : null
  if (!user || chat.userId !== user._id) {
    throw new Error("Execution grant not authorized")
  }

  return { user: user as Doc<"users">, chat, run }
}

export const updateAssistantSnapshot = internalMutation({
  args: {
    ...grantArgs,
    messageId: v.id("messages"),
    order: v.number(),
    stepOrder: v.optional(v.number()),
    sequence: v.number(),
    textSnapshot: v.string(),
    partsSnapshot: v.any(),
    delta: v.optional(v.string()),
    payload: v.optional(v.any()),
  },
  handler: async (ctx, { runId, grantDigest, ...args }) => {
    const owner = await requireGrantAuthorizedRun(ctx, { runId, grantDigest })
    return updateAssistantSnapshotForChat(ctx, owner, args)
  },
})

export const recordToolInvocations = internalMutation({
  args: {
    ...grantArgs,
    messageId: v.id("messages"),
    stepNumber: v.optional(v.number()),
    invocations: v.array(
      v.object({
        toolCallId: v.string(),
        toolName: v.string(),
        source: vToolSource,
        input: v.optional(v.any()),
        output: v.optional(v.any()),
        error: v.optional(v.string()),
        status: vToolInvocationStatus,
        approvalRequestId: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, { runId, grantDigest, ...args }) => {
    const owner = await requireGrantAuthorizedRun(ctx, { runId, grantDigest })
    return recordToolInvocationsForChat(ctx, owner, args)
  },
})

export const createToolApprovalRequest = internalMutation({
  args: {
    ...grantArgs,
    assistantMessageId: v.id("messages"),
    toolCallId: v.string(),
    toolName: v.string(),
    source: vToolSource,
    reason: v.optional(v.string()),
    riskClass: v.string(),
    inputPreview: v.optional(v.string()),
    approvalId: v.string(),
  },
  handler: async (ctx, { runId, grantDigest, ...args }) => {
    const owner = await requireGrantAuthorizedRun(ctx, { runId, grantDigest })
    return createToolApprovalRequestForChat(ctx, owner, args)
  },
})

export const markGenerationRunCompleted = internalMutation({
  args: {
    ...grantArgs,
    messageId: v.id("messages"),
    content: v.string(),
    parts: v.any(),
    metadata: v.optional(vToolInvocationStreamMetadata),
    finishReason: v.optional(v.string()),
    usage: v.optional(
      v.object({
        inputTokens: v.optional(v.number()),
        outputTokens: v.optional(v.number()),
        totalTokens: v.optional(v.number()),
      })
    ),
    totalToolCalls: v.optional(v.number()),
    failedToolCalls: v.optional(v.number()),
  },
  handler: async (ctx, { runId, grantDigest, ...args }) => {
    const owner = await requireGrantAuthorizedRun(ctx, { runId, grantDigest })
    return markGenerationRunCompletedForChat(ctx, owner, args)
  },
})

export const markGenerationRunFailed = internalMutation({
  args: {
    ...grantArgs,
    messageId: v.optional(v.id("messages")),
    error: v.string(),
  },
  handler: async (ctx, { runId, grantDigest, ...args }) => {
    const owner = await requireGrantAuthorizedRun(ctx, { runId, grantDigest })
    return markGenerationRunFailedForChat(ctx, owner, args)
  },
})

export const markGenerationRunAborted = internalMutation({
  args: {
    ...grantArgs,
    messageId: v.optional(v.id("messages")),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { runId, grantDigest, ...args }) => {
    const owner = await requireGrantAuthorizedRun(ctx, { runId, grantDigest })
    return markGenerationRunAbortedForChat(ctx, owner, args)
  },
})
