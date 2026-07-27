import { ConvexError, v, type ObjectType } from "convex/values"
import type { Id } from "./_generated/dataModel"
import { internalMutation, type MutationCtx } from "./_generated/server"
import {
  createToolApprovalRequestForChat,
  generationRunWriteArgs,
  heartbeatGenerationRunForChat,
  markGenerationRunAbortedForChat,
  markGenerationRunCompletedForChat,
  markGenerationRunFailedForChat,
  recordToolInvocationsForChat,
  updateAssistantSnapshotForChat,
} from "./chatRuntime"
import type { AuthenticatedRunOwner } from "./lib/auth"
import { timingSafeEqualHex } from "./lib/sha256"

// ---------------------------------------------------------------------------
// Chat-turn worker mutations (ADR-0011): the execution-grant half of durable
// settlement. The /chat-turn/worker HTTP action authenticates a Bearer secret
// by digest and dispatches here; each mutation re-verifies the grant against
// the run row transactionally, reconstructs the same `AuthenticatedRunOwner`
// the user-token wrappers inject, and reuses the `...ForChat` handlers — one
// policy, two authenticators. The raw secret never appears in mutation
// arguments; only its digest does, and internal mutations are unreachable
// from clients. Arg shapes are spread from `generationRunWriteArgs` — the one
// declaration both authenticators share.
// ---------------------------------------------------------------------------

const grantArgs = {
  runId: v.id("generationRuns"),
  grantDigest: v.string(),
}

/** The grant half of every worker mutation's args. */
export type GrantAuthArgs = ObjectType<typeof grantArgs>

/**
 * Per-op wire payloads, inferred from the shared validator shapes: what the
 * Next-side Durable worker wire sends as `args` (minus `runId`, which the wire
 * adds, and `grantDigest`, which the HTTP action derives from the Bearer
 * secret). The op list and each payload have exactly one source of truth.
 */
export type DurableWorkerPayloads = {
  [Op in keyof typeof generationRunWriteArgs]: ObjectType<
    (typeof generationRunWriteArgs)[Op]
  >
}

/**
 * Grant failures are typed application errors (`ConvexError`) so the HTTP
 * action can map them to 401 by code instead of sniffing message strings.
 * Wrong digest and missing run collapse to one code/message so a probing
 * caller cannot distinguish them; expiry is reported distinctly because the
 * legitimate worker needs to tell them apart in telemetry.
 */
export type GrantRejectionCode = "grant_unauthorized" | "grant_expired"

export const GRANT_REJECTION_MESSAGES: Record<GrantRejectionCode, string> = {
  grant_unauthorized: "Execution grant not authorized",
  grant_expired: "Execution grant expired",
}

function grantRejection(code: GrantRejectionCode): ConvexError<{
  grantRejection: GrantRejectionCode
  message: string
}> {
  return new ConvexError({
    grantRejection: code,
    message: GRANT_REJECTION_MESSAGES[code],
  })
}

/** The grant-rejection code carried by `error`, if it is one. */
export function grantRejectionCode(
  error: unknown
): GrantRejectionCode | undefined {
  if (!(error instanceof ConvexError)) return undefined
  const data: unknown = error.data
  if (!data || typeof data !== "object") return undefined
  const code = (data as { grantRejection?: unknown }).grantRejection
  return code === "grant_unauthorized" || code === "grant_expired"
    ? code
    : undefined
}

/**
 * Resolve the run an execution grant authorizes, or throw a typed
 * grant-rejection error (see `GrantRejectionCode` for the disclosure policy).
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
    throw grantRejection("grant_unauthorized")
  }
  if (!run.grantExpiresAt || run.grantExpiresAt <= Date.now()) {
    throw grantRejection("grant_expired")
  }

  const chat = await ctx.db.get(run.chatId)
  if (!chat) throw grantRejection("grant_unauthorized")
  const user = run.userId ? await ctx.db.get(run.userId) : null
  if (!user || chat.userId !== user._id) {
    throw grantRejection("grant_unauthorized")
  }

  // Root tombstone revokes every outstanding grant without scanning runs. OCC
  // orders the race: if deletion commits first, this read sees the marker and
  // rejects; if the worker write commits first, the deletion mutation retries.
  if (chat.deletingAt !== undefined) throw grantRejection("grant_unauthorized")
  if (chat.projectId) {
    const project = await ctx.db.get(chat.projectId)
    if (!project || project.deletingAt !== undefined) {
      throw grantRejection("grant_unauthorized")
    }
  }

  return { user, chat, run }
}

export const updateAssistantSnapshot = internalMutation({
  args: { ...grantArgs, ...generationRunWriteArgs.updateAssistantSnapshot },
  handler: async (ctx, { runId, grantDigest, ...args }) => {
    const owner = await requireGrantAuthorizedRun(ctx, { runId, grantDigest })
    return updateAssistantSnapshotForChat(ctx, owner, args)
  },
})

export const recordToolInvocations = internalMutation({
  args: { ...grantArgs, ...generationRunWriteArgs.recordToolInvocations },
  handler: async (ctx, { runId, grantDigest, ...args }) => {
    const owner = await requireGrantAuthorizedRun(ctx, { runId, grantDigest })
    return recordToolInvocationsForChat(ctx, owner, args)
  },
})

export const createToolApprovalRequest = internalMutation({
  args: { ...grantArgs, ...generationRunWriteArgs.createToolApprovalRequest },
  handler: async (ctx, { runId, grantDigest, ...args }) => {
    const owner = await requireGrantAuthorizedRun(ctx, { runId, grantDigest })
    return createToolApprovalRequestForChat(ctx, owner, args)
  },
})

export const markGenerationRunCompleted = internalMutation({
  args: { ...grantArgs, ...generationRunWriteArgs.markGenerationRunCompleted },
  handler: async (ctx, { runId, grantDigest, ...args }) => {
    const owner = await requireGrantAuthorizedRun(ctx, { runId, grantDigest })
    return markGenerationRunCompletedForChat(ctx, owner, args)
  },
})

export const markGenerationRunFailed = internalMutation({
  args: { ...grantArgs, ...generationRunWriteArgs.markGenerationRunFailed },
  handler: async (ctx, { runId, grantDigest, ...args }) => {
    const owner = await requireGrantAuthorizedRun(ctx, { runId, grantDigest })
    return markGenerationRunFailedForChat(ctx, owner, args)
  },
})

export const markGenerationRunAborted = internalMutation({
  args: { ...grantArgs, ...generationRunWriteArgs.markGenerationRunAborted },
  handler: async (ctx, { runId, grantDigest, ...args }) => {
    const owner = await requireGrantAuthorizedRun(ctx, { runId, grantDigest })
    return markGenerationRunAbortedForChat(ctx, owner, args)
  },
})

// Heartbeats are worker-wire only — there is deliberately no user-token twin
// (gameplan §0 amendment 1): the lease belongs to the executing worker, and
// the worker's only credential is the execution grant.
export const heartbeatGenerationRun = internalMutation({
  args: { ...grantArgs, ...generationRunWriteArgs.heartbeatGenerationRun },
  handler: async (ctx, { runId, grantDigest }) => {
    const owner = await requireGrantAuthorizedRun(ctx, { runId, grantDigest })
    return heartbeatGenerationRunForChat(ctx, owner)
  },
})
