import { ConvexError, v } from "convex/values"
import { CHAT_TURN_EXECUTION_BUDGET } from "../lib/chat-turn/execution-budget"
import type { Doc, Id } from "./_generated/dataModel"
import {
  internalMutation,
  mutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import {
  isIgnoredSignal,
  isSupersedableGenerationRunStatus,
  isSupersedableMessageStatus,
  resolveGenerationRunTransition,
  resolveTerminalAssistantMessageResolution,
  type AssistantMessageFacts,
  type LifecycleVerdict,
  type MessageResolution,
} from "./domain/generation_run_lifecycle"
import {
  APPROVAL_EXPIRY_MS,
  computeLeaseExpiresAt,
  computeLiveRunFreshUntil,
  isWorkerExecutingStatus,
} from "./domain/generation_run_liveness"
import { createMessageBranchWriter } from "./domain/message_branch_writes"
import {
  createBranchContext,
  getEffectiveParentIdFromContext,
  getSelectedPathMessagesFromContext,
  getSiblingMessagesFromContext,
} from "./domain/message_branches"
import {
  isTerminalGenerationRunStatus,
  isTerminalMessageStatus,
  type GenerationRunStatus,
} from "./domain/message_contract"
import { extractTextFromMessageParts } from "./domain/message_parts"
import {
  hasSemanticAssistantParts,
  isTerminalOutcomeStub,
  isVisibleChatMessage,
  projectModelHistoryMessages,
} from "./domain/message_visibility"
import { patchChatActivity } from "./domain/project_activity"
import {
  getCurrentUser,
  requireOwnedChat,
  type AuthenticatedChatOwner,
  type AuthenticatedRunOwner,
} from "./lib/auth"
import { ownedGenerationRunMutation } from "./lib/authedFunctions"
import {
  vToolInvocationStreamMetadata,
  type PersistedMessageMetadata,
} from "./lib/messageMetadata"

const MAX_PREVIEW_LENGTH = 500

const vMessageRole = v.union(
  v.literal("user"),
  v.literal("assistant"),
  v.literal("system"),
  v.literal("data")
)

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

const vUsage = v.object({
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  totalTokens: v.optional(v.number()),
})

/**
 * One declaration per generation-run write op. The user-token mutations below
 * and their grant-authorized worker twins (convex/chatRuntimeWorker.ts) spread
 * these same shapes, so a field added or renamed on one authenticator is a
 * compile + validator change on both — the Chat turn wire contract pattern.
 */
export const generationRunWriteArgs = {
  updateAssistantSnapshot: {
    messageId: v.id("messages"),
    order: v.number(),
    stepOrder: v.optional(v.number()),
    sequence: v.number(),
    textSnapshot: v.string(),
    partsSnapshot: v.any(),
    delta: v.optional(v.string()),
    payload: v.optional(v.any()),
  },
  recordToolInvocations: {
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
  createToolApprovalRequest: {
    assistantMessageId: v.id("messages"),
    toolCallId: v.string(),
    toolName: v.string(),
    source: vToolSource,
    reason: v.optional(v.string()),
    riskClass: v.string(),
    inputPreview: v.optional(v.string()),
    approvalId: v.string(),
  },
  markGenerationRunCompleted: {
    messageId: v.id("messages"),
    content: v.string(),
    parts: v.any(),
    metadata: v.optional(vToolInvocationStreamMetadata),
    finishReason: v.optional(v.string()),
    usage: v.optional(vUsage),
    totalToolCalls: v.optional(v.number()),
    failedToolCalls: v.optional(v.number()),
  },
  markGenerationRunFailed: {
    messageId: v.optional(v.id("messages")),
    error: v.string(),
  },
  markGenerationRunAborted: {
    messageId: v.optional(v.id("messages")),
    reason: v.optional(v.string()),
  },
  // The lease heartbeat (gameplan §6) — no payload beyond the run identity
  // the wire adds; the server clock is authoritative.
  heartbeatGenerationRun: {},
}

const vStoredMessage = v.object({
  id: v.string(),
  role: vMessageRole,
  content: v.optional(v.string()),
  parts: v.any(),
})

const vEditIntent = v.object({
  editedMessageId: v.string(),
  editCutoffTimestamp: v.number(),
  expectedChatVersion: v.number(),
  replacementMessage: v.object({
    id: v.string(),
    role: v.literal("user"),
    content: v.string(),
    parts: v.any(),
  }),
  title: v.optional(v.string()),
})

const vRegenerationIntent = v.object({
  targetAssistantMessageId: v.string(),
  targetAssistantCreatedAt: v.number(),
  expectedChatVersion: v.number(),
  precedingUserMessageId: v.string(),
})

const vApprovalResponse = v.object({
  messageId: v.string(),
  approvalId: v.string(),
  toolCallId: v.string(),
  toolName: v.string(),
  approved: v.boolean(),
  reason: v.optional(v.string()),
})

type ApprovalResponse = {
  approved: boolean
  reason?: string
}

type StoredApprovalDecision = {
  status: "pending" | "approved" | "denied" | "expired"
  reason?: string
}

type CanonicalApprovalDecision = {
  status: "approved" | "denied"
  approved: boolean
  reason?: string
}

const ACTIVE_RUN_SCAN_LIMIT = 50

/**
 * Execution-grant lifetime (ADR-0011), budget-derived (route max + settlement
 * reserve + slack — durable-turn gameplan §0). Must comfortably exceed the
 * longest legitimate turn plus settlement retries; it bounds how long a leaked
 * digest preimage could authorize idempotent worker writes. Expiry is the
 * backstop revocation; absorbing terminal transitions (aborted/failed) also
 * clear the grant fields eagerly via `applyLifecycleVerdict`.
 */
export const EXECUTION_GRANT_TTL_MS = CHAT_TURN_EXECUTION_BUDGET.grantTtlMs

const terminalToolInvocationStatuses = new Set<
  Doc<"toolInvocations">["status"]
>(["denied", "completed", "failed"])

/**
 * Absorbing terminal outcomes (`aborted`, `failed`) also revoke the execution
 * grant eagerly — nothing may overwrite them, so the grant authorizes nothing
 * but rejections from here on (gameplan §0 amendment 2). `completed` keeps its
 * grant while the deliberate fail-over-completed convergence exists: the
 * fire-and-forget failure write must still land after a spurious completion.
 * `awaiting_approval` is a pause, not a settlement — the pausing worker's
 * final flush and completion downgrade still need the grant.
 */
function grantRevocationForStatus(
  status: GenerationRunStatus
): Partial<Doc<"generationRuns">> {
  return status === "aborted" || status === "failed"
    ? { grantDigest: undefined, grantExpiresAt: undefined }
    : {}
}

/**
 * Lease fields clear at every terminal transition AND at the approval pause
 * (gameplan §6 step 6): a paused run is lease-free — its liveness is the
 * pending unexpired approval, not a heartbeat.
 */
const LEASE_CLEAR: Partial<Doc<"generationRuns">> = {
  heartbeatAt: undefined,
  leaseExpiresAt: undefined,
}

function truncatePreview(value: unknown): string | undefined {
  if (value === undefined) return undefined
  let text: string
  if (typeof value === "string") {
    text = value
  } else {
    try {
      text = JSON.stringify(value)
    } catch {
      text = String(value)
    }
  }
  if (text.length <= MAX_PREVIEW_LENGTH) return text
  return `${text.slice(0, MAX_PREVIEW_LENGTH)}...`
}

function nowMs(): number {
  return Date.now()
}

function isAssistantMessageLinkedToRun(
  message: Doc<"messages">,
  run: Doc<"generationRuns">
): boolean {
  return (
    message.generationRunId === run._id ||
    run.assistantMessageId === message._id ||
    run.activeStreamId === message._id
  )
}

async function requireAssistantMessageForRun(
  ctx: MutationCtx,
  run: Doc<"generationRuns">,
  messageId: Id<"messages">
): Promise<Doc<"messages">> {
  const message = await ctx.db.get(messageId)
  if (
    !message ||
    message.chatId !== run.chatId ||
    message.role !== "assistant" ||
    !isAssistantMessageLinkedToRun(message, run)
  ) {
    throw new Error("Assistant message not found for run")
  }
  return message
}

async function listMessages(ctx: QueryCtx | MutationCtx, chatId: Id<"chats">) {
  return await ctx.db
    .query("messages")
    .withIndex("by_chat_order", (q) => q.eq("chatId", chatId))
    .collect()
}

function findMessageByUiId(
  messages: Doc<"messages">[],
  messageId: string
): Doc<"messages"> | undefined {
  return messages.find(
    (message) =>
      message._id === messageId || message.clientMessageId === messageId
  )
}

function findMessageIndexByUiId(
  messages: Doc<"messages">[],
  messageId: string
): number {
  return messages.findIndex(
    (message) =>
      message._id === messageId || message.clientMessageId === messageId
  )
}

/**
 * Selected-path derivation for runtime consumers: one context serves the
 * whole call (plan PR 1 step 4; made unconditional in the 2026-07-23 flag
 * collapse).
 */
function getSelectedPath(messages: Doc<"messages">[]) {
  return getSelectedPathMessagesFromContext(createBranchContext(messages))
}

function getVisibleSelectedMessages(messages: Doc<"messages">[]) {
  return getSelectedPath(messages).filter(isVisibleChatMessage)
}

function selectedMessagesMatchToken(
  selectedMessages: Doc<"messages">[],
  token: Required<Pick<SelectedPathToken, "expectedVisibleMessageCount">> &
    Pick<SelectedPathToken, "tailMessageId">
) {
  if (selectedMessages.length !== token.expectedVisibleMessageCount) {
    return false
  }

  const tailMessage = selectedMessages[selectedMessages.length - 1]
  const actualTailMessageId = tailMessage?._id

  return (
    token.tailMessageId === undefined ||
    actualTailMessageId === token.tailMessageId
  )
}

function validateSelectedPathToken(
  messages: Doc<"messages">[],
  token: SelectedPathToken
) {
  if (token.expectedVisibleMessageCount === undefined) {
    throw new Error("Selected path token required")
  }

  const selectedMessages = getVisibleSelectedMessages(messages)
  const requiredToken = {
    expectedVisibleMessageCount: token.expectedVisibleMessageCount,
    tailMessageId: token.tailMessageId,
  }

  if (selectedMessagesMatchToken(selectedMessages, requiredToken)) return

  const selectedMessagesBeforeTerminalStubs = selectedMessages.filter(
    (message) => !isTerminalOutcomeStub(message)
  )
  if (
    selectedMessagesBeforeTerminalStubs.length !== selectedMessages.length &&
    selectedMessagesMatchToken(
      selectedMessagesBeforeTerminalStubs,
      requiredToken
    )
  ) {
    return
  }

  throw new Error("Stale chat state: selected path changed")
}

async function validateSelectedPathTokenForChat(
  ctx: MutationCtx,
  chatId: Id<"chats">,
  token: SelectedPathToken
) {
  validateSelectedPathToken(await listMessages(ctx, chatId), token)
}

// Resolves the semantic sibling an empty terminal placeholder reverts to,
// preferring the branch a regeneration forked from (regenerationSourceMessageId),
// else the latest. Pure over the messages array — the Generation run lifecycle
// consumes only the precomputed id, so branch logic stays out of the module.
function resolveFallbackSibling(
  messages: Doc<"messages">[],
  message: Doc<"messages">
): Id<"messages"> | null {
  const context = createBranchContext(messages)
  const parentMessageId = getEffectiveParentIdFromContext(context, message)
  const semanticSiblings = getSiblingMessagesFromContext(
    context,
    parentMessageId,
    message.role
  ).filter(
    (sibling) =>
      sibling._id !== message._id && hasSemanticAssistantParts(sibling)
  )
  const fallbackSibling =
    semanticSiblings.find(
      (sibling) => sibling._id === message.regenerationSourceMessageId
    ) ?? semanticSiblings.at(-1)
  return fallbackSibling?._id ?? null
}

// The assistant message a terminal transition resolves against, plus the facts
// the Generation run lifecycle needs. `messages` is the chat's message list,
// loaded only when the message is empty (matching the pre-extraction lazy read)
// and reused by delete-and-reselect so it is never read twice.
type ResolvedAssistantMessage = {
  message: Doc<"messages">
  messages: Doc<"messages">[] | null
  facts: AssistantMessageFacts
}

// Gather-phase counterpart to the module's resolve: reads the target message
// (messageId ?? run.assistantMessageId ?? run.activeStreamId), validates
// chatId/role linkage, and builds the AssistantMessageFacts. Returns null when
// no linked assistant message resolves — the module then treats the message half
// as a no-op and the run keeps its existing assistantMessageId.
async function gatherAssistantMessageFacts(
  ctx: MutationCtx,
  run: Doc<"generationRuns">,
  messageId?: Id<"messages">
): Promise<ResolvedAssistantMessage | null> {
  const activeStreamMessageId =
    run.activeStreamId === undefined
      ? null
      : ctx.db.normalizeId("messages", run.activeStreamId)
  const resolvedMessageId =
    messageId ?? run.assistantMessageId ?? activeStreamMessageId
  if (!resolvedMessageId) return null

  const message = await ctx.db.get(resolvedMessageId)
  // Linkage is required, not just chat membership: a caller-supplied messageId
  // naming a DIFFERENT assistant message in the same chat (a confused or
  // malicious worker payload) must not let markGenerationRunFailed/-Aborted
  // stamp that message with this run's terminal outcome. An unlinked target
  // resolves like a missing one — the run half still settles; the message half
  // is a no-op.
  if (
    !message ||
    message.chatId !== run.chatId ||
    message.role !== "assistant" ||
    !isAssistantMessageLinkedToRun(message, run)
  ) {
    return null
  }

  const isReusedForRegeneration =
    typeof run.startedAt === "number" && message.createdAt < run.startedAt
  // Projected-output invariant: `lastSnapshotSequence` is patched in the same
  // mutation as every accepted checkpoint (both branches of
  // updateAssistantSnapshotForChat) and sequences start at 1, so `> 0` is
  // equivalent to "at least one accepted checkpoint for this run". Legacy runs
  // written before the field existed fall back to the row probe; that fallback
  // (and the rows it reads) may be removed only after the legacy purge.
  const hasSnapshotForRun = isReusedForRegeneration
    ? run.lastSnapshotSequence !== undefined
      ? run.lastSnapshotSequence > 0
      : (await ctx.db
          .query("assistantMessageSnapshots")
          .withIndex("by_run_sequence", (q) => q.eq("runId", run._id))
          .first()) !== null
    : false

  const hasSemanticParts = hasSemanticAssistantParts(message)
  let messages: Doc<"messages">[] | null = null
  let fallbackSiblingId: Id<"messages"> | null = null
  if (!hasSemanticParts) {
    messages = await listMessages(ctx, message.chatId)
    fallbackSiblingId = resolveFallbackSibling(messages, message)
  }

  return {
    message,
    messages,
    facts: {
      hasSemanticParts,
      isReusedForRegeneration,
      hasSnapshotForRun,
      fallbackSiblingId,
    },
  }
}

// Applies the message half of a verdict. Returns the surviving assistant message
// id, or undefined when the empty placeholder was deleted.
async function applyMessageResolution(
  ctx: MutationCtx,
  message: Doc<"messages">,
  resolution: MessageResolution,
  messages: Doc<"messages">[] | null,
  now: number
): Promise<Id<"messages"> | undefined> {
  switch (resolution.kind) {
    case "none":
      return message._id
    case "restore-completed":
      await ctx.db.patch(message._id, {
        status: "completed",
        error: undefined,
        updatedAt: now,
      })
      return message._id
    case "stamp":
    case "keep-stub":
      await ctx.db.patch(message._id, {
        status: resolution.status,
        error: resolution.error,
        updatedAt: now,
      })
      return message._id
    case "delete-and-reselect": {
      // Only re-select when the placeholder was the selected branch.
      if (message.selected === true && messages) {
        const sibling = messages.find(
          (candidate) => candidate._id === resolution.siblingId
        )
        if (sibling) {
          await createMessageBranchWriter(ctx, {
            chatId: message.chatId,
            now,
          }).select(sibling._id)
        }
      }
      await ctx.db.delete(message._id)
      return undefined
    }
  }
}

// Sidebar status projection — mirror a run's lifecycle phase onto its chat doc
// so every sidebar row derives its indicator from the chat it already subscribes
// to, with no separate query/store/hydrator
// (docs/design/sidebar-status-backend-wiring.md). These fields are owner-only;
// chats.getById/getPublicById strip them from non-owner reads.
//
// `queued`/`running`/`streaming` map to the live spinner (only the run-start
// claim ever writes them, inline below — `queued` is never persisted); the
// terminal arms clear the live phase, and `completed`/`failed` also stamp the
// Phase-2 mirror. Patching `liveRunStatus: undefined` removes the field (Convex
// `patch` semantics) — that is the "clear."
function chatStatusProjection(
  status: GenerationRunStatus,
  now: number
): Partial<Doc<"chats">> {
  switch (status) {
    case "queued":
    case "running":
    case "streaming":
      return { liveRunStatus: "streaming" }
    case "awaiting_approval":
      // The approval-pause handler stamps liveRunFreshUntil = approval expiry
      // itself (it knows the deadline); the projection leaves it alone.
      return { liveRunStatus: "awaiting" }
    case "completed":
      return {
        liveRunStatus: undefined,
        liveRunFreshUntil: undefined,
        lastRunEndedAt: now,
        lastRunStatus: "completed",
      }
    case "failed":
      return {
        liveRunStatus: undefined,
        liveRunFreshUntil: undefined,
        lastRunEndedAt: now,
        lastRunStatus: "failed",
      }
    case "aborted":
      // User Stop / supersede — no signal; only clear the live phase.
      return { liveRunStatus: undefined, liveRunFreshUntil: undefined }
  }
}

// Run-scoped guard: only the run that OWNS the chat's status slot (statusRunId)
// may project. statusRunId is KEPT after a terminal, so a same-run
// completed→failed convergence still applies; an OLDER run's late terminal is a
// no-op once a newer run has claimed the slot. Convex mutations are
// transactional, so this read-guard-then-patch is race-free.
async function projectRunStatusToChat(
  ctx: MutationCtx,
  run: Doc<"generationRuns">,
  status: GenerationRunStatus,
  now: number,
  // Extra owner-guarded chat fields riding the same projection write (the
  // approval pause stamps liveRunFreshUntil = approval expiry here).
  extra?: Partial<Doc<"chats">>
) {
  const chat = await ctx.db.get(run.chatId)
  if (!chat || chat.statusRunId !== run._id) return // a newer run owns the row → skip
  await ctx.db.patch(run.chatId, {
    ...chatStatusProjection(status, now),
    ...extra,
  })
}

// Applies a transition verdict for the terminal-close paths (fail/abort/
// supersede): the message half (stamp / keep-stub / delete + reselect /
// restore-completed), then the run's shared terminal field set. Returns the
// resulting assistantMessageId (undefined when the linked placeholder was
// deleted). Call sites that write extra run fields keep them: completed's
// usage/toolCounts and approval-requested's minimal pause patch the run
// directly rather than routing through here.
async function applyLifecycleVerdict(
  ctx: MutationCtx,
  run: Doc<"generationRuns">,
  verdict: Extract<LifecycleVerdict, { kind: "transition" }>,
  resolved: ResolvedAssistantMessage | null,
  now: number
): Promise<Id<"messages"> | undefined> {
  let assistantMessageId = run.assistantMessageId
  if (resolved) {
    const survivingId = await applyMessageResolution(
      ctx,
      resolved.message,
      verdict.message,
      resolved.messages,
      now
    )
    assistantMessageId =
      survivingId ??
      (run.assistantMessageId === resolved.message._id
        ? undefined
        : run.assistantMessageId)
  }

  await ctx.db.patch(run._id, {
    status: verdict.run.status,
    error: verdict.run.error,
    completedAt: verdict.run.settle ? now : undefined,
    updatedAt: now,
    ...(verdict.run.clearActiveStream ? { activeStreamId: undefined } : {}),
    ...(verdict.run.terminalReason
      ? { terminalReason: verdict.run.terminalReason }
      : {}),
    ...grantRevocationForStatus(verdict.run.status),
    ...LEASE_CLEAR,
    assistantMessageId,
  })

  // Mirror the terminal phase onto the chat row (fail/abort/supersede all reach
  // here). Guarded by statusRunId, so a superseded/older run can't clear a newer
  // run's live spinner.
  await projectRunStatusToChat(ctx, run, verdict.run.status, now)

  return assistantMessageId
}

async function closeSupersededGenerationsForChat(
  ctx: MutationCtx,
  chatId: Id<"chats">,
  userId: Id<"users">,
  now: number
) {
  const runs = await ctx.db
    .query("generationRuns")
    .withIndex("by_chat_updated", (q) => q.eq("chatId", chatId))
    .order("desc")
    .take(ACTIVE_RUN_SCAN_LIMIT)

  const supersededRunIds = new Set<Id<"generationRuns">>()
  const supersededMessageIds = new Set<Id<"messages">>()
  const reason = "superseded by a new generation"

  for (const run of runs) {
    // Fast-path pre-filter with the lifecycle predicate. The supersede resolve
    // below is authoritative, but gathering facts for every run in the scan
    // window (most already terminal) would be wasteful — same predicate, same
    // answer, so a non-supersedable run never reaches the gather.
    if (!isSupersedableGenerationRunStatus(run.status)) continue
    if (run.userId !== undefined && run.userId !== userId) continue

    const resolved = await gatherAssistantMessageFacts(ctx, run, undefined)
    const verdict = resolveGenerationRunTransition(
      { runStatus: run.status, message: resolved?.facts ?? null },
      { kind: "supersede", reason }
    )
    if (verdict.kind === "ignore") continue

    supersededRunIds.add(run._id)
    const assistantMessageId = await applyLifecycleVerdict(
      ctx,
      run,
      verdict,
      resolved,
      now
    )
    if (assistantMessageId) supersededMessageIds.add(assistantMessageId)
  }

  const assistantMessages = await ctx.db
    .query("messages")
    .withIndex("by_chat_role", (q) =>
      q.eq("chatId", chatId).eq("role", "assistant")
    )
    .collect()

  for (const message of assistantMessages) {
    if (supersededMessageIds.has(message._id)) continue
    // Terminal statuses are settled turns — completed answers and first-class
    // failed/aborted stubs alike. The sweep must not delete or restate them;
    // it only closes out messages a live-looking run left behind.
    if (!isSupersedableMessageStatus(message.status)) continue

    // Orphan messages whose run fell outside the scan window: the terminal
    // policy runs with no reused-regeneration restore (there is no run in hand
    // to date the message against), so an empty message keeps/deletes and a
    // semantic one is stamped aborted — the pre-extraction split, unchanged.
    const hasSemantic = hasSemanticAssistantParts(message)
    let orphanMessages: Doc<"messages">[] | null = null
    let fallbackSiblingId: Id<"messages"> | null = null
    if (!hasSemantic) {
      orphanMessages = await listMessages(ctx, chatId)
      fallbackSiblingId = resolveFallbackSibling(orphanMessages, message)
    }
    const supersededMessageId = await applyMessageResolution(
      ctx,
      message,
      resolveTerminalAssistantMessageResolution(
        {
          hasSemanticParts: hasSemantic,
          isReusedForRegeneration: false,
          hasSnapshotForRun: false,
          fallbackSiblingId,
        },
        { status: "aborted", error: reason }
      ),
      orphanMessages,
      now
    )

    if (
      message.generationRunId &&
      !supersededRunIds.has(message.generationRunId)
    ) {
      const run = await ctx.db.get(message.generationRunId)
      if (run && run.chatId === chatId) {
        // The message half was already resolved above; the run closes via the
        // lifecycle's supersede rule like the in-window runs, with message:null
        // so the verdict does not restate it.
        const verdict = resolveGenerationRunTransition(
          { runStatus: run.status, message: null },
          { kind: "supersede", reason }
        )
        if (verdict.kind === "transition") {
          await ctx.db.patch(run._id, {
            status: verdict.run.status,
            error: verdict.run.error,
            completedAt: verdict.run.settle ? now : undefined,
            updatedAt: now,
            activeStreamId: undefined,
            ...(verdict.run.terminalReason
              ? { terminalReason: verdict.run.terminalReason }
              : {}),
            ...grantRevocationForStatus(verdict.run.status),
            ...LEASE_CLEAR,
            assistantMessageId: supersededMessageId,
          })
        }
      }
    }
  }
}

type StoredUserMessage = {
  id: string
  role: "user"
  content?: string
  parts: unknown
}

type GenerationEditIntent = {
  editedMessageId: string
  editCutoffTimestamp: number
  expectedChatVersion: number
  replacementMessage: StoredUserMessage & { content: string }
  title?: string
}

type GenerationRegenerationIntent = {
  targetAssistantMessageId: string
  targetAssistantCreatedAt: number
  expectedChatVersion: number
  precedingUserMessageId: string
}

type SelectedPathToken = {
  expectedVisibleMessageCount?: number
  tailMessageId?: string
}

// The selected path token is validated by the caller BEFORE the supersede
// sweep runs (prepareGenerationForChat) — the token describes the client's
// rendered view, and the sweep may legitimately materialize a terminal stub
// the client could not have counted yet. Re-validating here after the sweep
// falsely rejected the first send following a reaped zombie run.
async function selectOrInsertLatestUserMessageForGeneration(
  ctx: MutationCtx,
  owner: AuthenticatedChatOwner,
  args: {
    chatId: Id<"chats">
    requestId: string
    model: string
    provider: string
  },
  latestUserMessage: StoredUserMessage,
  now: number
) {
  const message = await createMessageBranchWriter(ctx, {
    chatId: args.chatId,
    now,
  }).writeUserMessage({
    clientMessageId: latestUserMessage.id,
    userId: owner.user._id,
    content:
      latestUserMessage.content ??
      extractTextFromMessageParts(latestUserMessage.parts),
    parts: latestUserMessage.parts,
    requestId: args.requestId,
    model: args.model,
    provider: args.provider,
  })
  return message._id
}

export async function applyRegenerationIntentForGeneration(
  ctx: MutationCtx,
  owner: AuthenticatedChatOwner,
  args: {
    chatId: Id<"chats">
    requestId: string
    model: string
    provider: string
    runId: Id<"generationRuns">
    regeneration: GenerationRegenerationIntent
  },
  now: number
) {
  // Guard contract: count the RAW projection — the same derivation the
  // client read (messages.ts) rendered from — deliberately un-normalized.
  // Normalization happens inside the Message branch writer AFTER this guard;
  // a normalize-before-guard pass is the "falsely rejected after a rapid
  // multi-branch session" bug class.
  const currentMessages = await listMessages(ctx, args.chatId)
  const selectedMessages = getVisibleSelectedMessages(currentMessages)
  if (selectedMessages.length !== args.regeneration.expectedChatVersion) {
    throw new Error("Chat changed since regeneration started")
  }

  const targetIndex = findMessageIndexByUiId(
    selectedMessages,
    args.regeneration.targetAssistantMessageId
  )
  if (targetIndex === -1) throw new Error("Regeneration target not found")

  const targetMessage = selectedMessages[targetIndex]
  if (!targetMessage || targetMessage.role !== "assistant") {
    throw new Error("Regeneration target must be an assistant message")
  }

  if (targetMessage.createdAt !== args.regeneration.targetAssistantCreatedAt) {
    throw new Error("Regeneration target version changed")
  }

  // Regeneration may target any assistant on the selected path, not just the
  // tail. A mid-conversation regen forks at the target's parent: the branch
  // writes below insert a new selected sibling and deselect the old subtree,
  // and the client renders the fork via the selected-path projection seam.
  // See CONTEXT.md "Chat turn" (edit/regenerate may target any prior message).
  let pairedUserIndex = -1
  for (let index = targetIndex - 1; index >= 0; index--) {
    if (selectedMessages[index]?.role === "user") {
      pairedUserIndex = index
      break
    }
  }
  if (pairedUserIndex === -1) {
    throw new Error("Regeneration preceding user message not found")
  }

  const requestedPrecedingUser = findMessageByUiId(
    selectedMessages,
    args.regeneration.precedingUserMessageId
  )
  const pairedUser = selectedMessages[pairedUserIndex]
  if (
    !requestedPrecedingUser ||
    !pairedUser ||
    requestedPrecedingUser.role !== "user" ||
    requestedPrecedingUser._id !== pairedUser._id
  ) {
    throw new Error("Regeneration preceding user message mismatch")
  }

  await denyPendingApprovalsForChat(
    ctx,
    args.chatId,
    owner.user._id,
    "auto-denied: new generation started"
  )

  const assistantMessage = await createMessageBranchWriter(ctx, {
    chatId: args.chatId,
    now,
  }).writeAssistantPlaceholder({
    generationRunId: args.runId,
    requestId: args.requestId,
    model: args.model,
    provider: args.provider,
    replaces: targetMessage._id,
  })
  const assistantMessageId = assistantMessage._id
  const assistantOrder = assistantMessage.orderId

  return {
    assistantMessageId,
    assistantOrder,
    messages: projectModelHistoryMessages(
      selectedMessages.slice(0, pairedUserIndex + 1)
    ),
  }
}

export async function applyEditIntentForGeneration(
  ctx: MutationCtx,
  owner: AuthenticatedChatOwner,
  args: {
    chatId: Id<"chats">
    requestId: string
    model: string
    provider: string
    edit: GenerationEditIntent
  },
  now: number
) {
  // Same guard contract as the regeneration guard above: raw projection,
  // matching the client's rendered count; never normalize before guarding.
  const currentMessages = await listMessages(ctx, args.chatId)
  const selectedMessages = getVisibleSelectedMessages(currentMessages)
  if (selectedMessages.length !== args.edit.expectedChatVersion) {
    throw new Error("Chat changed since edit started")
  }

  const editedMessage = findMessageByUiId(
    selectedMessages,
    args.edit.editedMessageId
  )
  const replacementMessage = currentMessages.find(
    (message) =>
      message.role === "user" &&
      message.clientMessageId === args.edit.replacementMessage.id
  )

  if (!editedMessage && !replacementMessage) {
    throw new Error("Edited message not found")
  }

  if (editedMessage && editedMessage.role !== "user") {
    throw new Error("Edited message must be a user message")
  }

  if (
    editedMessage &&
    editedMessage.createdAt !== args.edit.editCutoffTimestamp
  ) {
    throw new Error("Edited message version changed")
  }

  await createMessageBranchWriter(ctx, {
    chatId: args.chatId,
    now,
  }).writeUserMessage({
    clientMessageId: args.edit.replacementMessage.id,
    userId: owner.user._id,
    content: args.edit.replacementMessage.content,
    parts: args.edit.replacementMessage.parts,
    requestId: args.requestId,
    model: args.model,
    provider: args.provider,
    replaces: editedMessage?._id,
  })

  if (args.edit.title) {
    await ctx.db.patch(args.chatId, { title: args.edit.title })
  }
}

function applyApprovalResponseToParts(
  parts: unknown,
  response: {
    approvalId: string
    toolCallId: string
    approved: boolean
    reason?: string
  }
): unknown {
  if (!Array.isArray(parts)) return parts

  return parts.map((part) => {
    if (!part || typeof part !== "object") return part
    const record = part as Record<string, unknown>
    if (record.toolCallId !== response.toolCallId) return part
    const approval = record.approval
    const approvalRecord =
      approval && typeof approval === "object"
        ? (approval as Record<string, unknown>)
        : null
    if (approvalRecord?.id !== response.approvalId) return part

    return {
      ...record,
      state: "approval-responded",
      approval: {
        id: response.approvalId,
        approved: response.approved,
        ...(response.reason ? { reason: response.reason } : {}),
      },
    }
  })
}

export function resolveCanonicalApprovalDecision(
  approval: StoredApprovalDecision,
  response: ApprovalResponse
): CanonicalApprovalDecision {
  if (approval.status === "pending") {
    throw new Error("Approval has not been resolved")
  }
  if (approval.status === "expired") {
    throw new Error("Approval has expired")
  }

  const approved = approval.status === "approved"
  if (response.approved !== approved) {
    throw new Error("Approval response does not match stored approval decision")
  }

  return {
    status: approval.status,
    approved,
    reason: approval.reason,
  }
}

export async function denyPendingApprovalsForChat(
  ctx: MutationCtx,
  chatId: Id<"chats">,
  userId: Id<"users">,
  reason: string
) {
  const pending = await ctx.db
    .query("toolApprovalRequests")
    .withIndex("by_chat_status", (q) =>
      q.eq("chatId", chatId).eq("status", "pending")
    )
    .collect()
  const now = nowMs()

  for (const request of pending) {
    if (request.userId !== userId) continue
    const run = await ctx.db.get(request.runId)
    const assistantMessages = await ctx.db
      .query("messages")
      .withIndex("by_chat_role", (q) =>
        q.eq("chatId", chatId).eq("role", "assistant")
      )
      .collect()
    const associatedMessages = assistantMessages.filter(
      (message) =>
        message._id === request.assistantMessageId ||
        message.generationRunId === request.runId
    )
    const invocationCandidates = await ctx.db
      .query("toolInvocations")
      .withIndex("by_run_tool_call", (q) =>
        q.eq("runId", request.runId).eq("toolCallId", request.toolCallId)
      )
      .collect()
    const runInvocations = await ctx.db
      .query("toolInvocations")
      .withIndex("by_run", (q) => q.eq("runId", request.runId))
      .collect()
    const invocationIds = new Set<Id<"toolInvocations">>()
    const associatedInvocations = [
      ...invocationCandidates,
      ...runInvocations,
    ].filter((invocation) => {
      if (invocationIds.has(invocation._id)) return false
      if (invocation.chatId !== chatId) return false
      const isAssociated =
        invocation.toolCallId === request.toolCallId ||
        invocation.approvalId === request._id ||
        invocation.approvalRequestId === request.approvalId
      if (!isAssociated) return false
      invocationIds.add(invocation._id)
      return true
    })

    await ctx.db.patch(request._id, {
      status: "denied",
      resolvedAt: now,
      resolvedByUserId: userId,
      reason,
    })

    for (const message of associatedMessages) {
      await ctx.db.patch(message._id, {
        parts: applyApprovalResponseToParts(message.parts, {
          approvalId: request.approvalId,
          toolCallId: request.toolCallId,
          approved: false,
          reason,
        }),
        ...(!isTerminalMessageStatus(message.status)
          ? { status: "aborted" as const, error: reason }
          : {}),
        updatedAt: now,
      })
    }

    for (const invocation of associatedInvocations) {
      if (terminalToolInvocationStatuses.has(invocation.status)) continue
      await ctx.db.patch(invocation._id, {
        status: "denied",
        approvalId: request._id,
        approvalRequestId: request.approvalId,
        completedAt: now,
        updatedAt: now,
      })
    }

    if (
      run &&
      run.chatId === chatId &&
      (run.userId === undefined || run.userId === userId)
    ) {
      // The run closes via the Generation run lifecycle's `abort` rule (a run
      // already terminal is left settled). Only the run patch routes through the
      // module — the message parts/status writes are the per-message loop above.
      const verdict = resolveGenerationRunTransition(
        { runStatus: run.status, message: null },
        { kind: "abort", reason }
      )
      if (verdict.kind === "transition") {
        await ctx.db.patch(request.runId, {
          status: verdict.run.status,
          error: verdict.run.error,
          completedAt: verdict.run.settle ? now : undefined,
          updatedAt: now,
          activeStreamId: undefined,
          ...(verdict.run.terminalReason
            ? { terminalReason: verdict.run.terminalReason }
            : {}),
          ...grantRevocationForStatus(verdict.run.status),
          ...LEASE_CLEAR,
        })
      }
    }
  }
}

export async function applyApprovalResponses(
  ctx: MutationCtx,
  owner: AuthenticatedChatOwner,
  responses: Array<{
    messageId: string
    approvalId: string
    toolCallId: string
    toolName: string
    approved: boolean
    reason?: string
  }>
): Promise<{
  message: Doc<"messages">
  /**
   * The run the resolved approvals PAUSED — the continuation-idempotency
   * anchor (its `continuationRunId` is checked and stamped by prepare's
   * continuation branch). Read from the approval rows, not the message's
   * `generationRunId`, which a prior continuation already re-pointed.
   */
  pausedRunId: Id<"generationRuns"> | null
  /**
   * True when THIS transaction's `approvals-resolved` close transitioned the
   * paused run — i.e. the pause was still live (`awaiting_approval`) when
   * this prepare began. False means the pause was already settled by an
   * earlier writer (a Stop that denied the approvals, a supersession, a
   * reap): the continuation branch must CONFLICT rather than resurrect a
   * settled run (gameplan §13 race #16).
   */
  pausedRunWasLive: boolean
} | null> {
  if (responses.length === 0) return null

  const messages = await listMessages(ctx, owner.chat._id)
  const messageById = new Map(messages.map((message) => [message._id, message]))
  let updatedMessage: Doc<"messages"> | null = null
  let pausedRunId: Id<"generationRuns"> | null = null
  const now = nowMs()
  const runDecisions = new Map<Id<"generationRuns">, { denied: boolean }>()

  for (const response of responses) {
    const approval = await ctx.db
      .query("toolApprovalRequests")
      .withIndex("by_approval", (q) => q.eq("approvalId", response.approvalId))
      .unique()

    if (
      !approval ||
      approval.chatId !== owner.chat._id ||
      approval.userId !== owner.user._id ||
      approval.toolCallId !== response.toolCallId
    ) {
      throw new Error("Approval not found")
    }

    const canonicalDecision = resolveCanonicalApprovalDecision(
      approval,
      response
    )
    const runDecision = runDecisions.get(approval.runId)
    runDecisions.set(approval.runId, {
      denied: (runDecision?.denied ?? false) || !canonicalDecision.approved,
    })
    pausedRunId = approval.runId

    const message = findMessageByUiId(messages, response.messageId)
    if (!message || message.chatId !== owner.chat._id) {
      throw new Error("Approval message not found")
    }

    const currentMessage = messageById.get(message._id) ?? message
    const nextParts = applyApprovalResponseToParts(currentMessage.parts, {
      ...response,
      approved: canonicalDecision.approved,
      reason: canonicalDecision.reason,
    })
    await ctx.db.patch(message._id, {
      parts: nextParts,
      status: "streaming",
      updatedAt: now,
    })
    const refreshed = await ctx.db.get(message._id)
    updatedMessage = refreshed ?? {
      ...currentMessage,
      parts: nextParts,
      status: "streaming",
      updatedAt: now,
    }
    messageById.set(message._id, updatedMessage)

    const invocation = await ctx.db
      .query("toolInvocations")
      .withIndex("by_run_tool_call", (q) =>
        q.eq("runId", approval.runId).eq("toolCallId", response.toolCallId)
      )
      .unique()
    if (invocation) {
      await ctx.db.patch(invocation._id, {
        status: canonicalDecision.status,
        approvalId: approval._id,
        approvalRequestId: approval.approvalId,
        updatedAt: now,
      })
    }
  }

  let pausedRunWasLive = false
  for (const [runId, runDecision] of runDecisions) {
    const run = await ctx.db.get(runId)
    if (!run) continue
    // The continuation closes the paused run via the Generation run lifecycle's
    // `approvals-resolved` rule. A run already settled (a racing Stop aborted it
    // mid-approval) is left alone — the late resolution must not repaint it. The
    // continuation message stays "streaming" (patched above): it belongs to the
    // NEW continuation run's prepare, not this close.
    const verdict = resolveGenerationRunTransition(
      { runStatus: run.status, message: null },
      { kind: "approvals-resolved", anyDenied: runDecision.denied }
    )
    if (verdict.kind === "ignore") continue
    if (runId === pausedRunId) pausedRunWasLive = true
    await ctx.db.patch(runId, {
      status: verdict.run.status,
      completedAt: verdict.run.settle ? now : undefined,
      updatedAt: now,
      activeStreamId: undefined,
      ...(verdict.run.terminalReason
        ? { terminalReason: verdict.run.terminalReason }
        : {}),
      ...grantRevocationForStatus(verdict.run.status),
      ...LEASE_CLEAR,
    })
  }

  return updatedMessage
    ? { message: updatedMessage, pausedRunId, pausedRunWasLive }
    : null
}

type GenerationApprovalResponse = {
  messageId: string
  approvalId: string
  toolCallId: string
  toolName: string
  approved: boolean
  reason?: string
}

type PrepareGenerationForChatArgs = {
  chatId: Id<"chats">
  requestId: string
  model: string
  provider: string
  expectedVisibleMessageCount?: number
  tailMessageId?: string
  latestUserMessage?: {
    id: string
    role: "user" | "assistant" | "system" | "data"
    content?: string
    parts: unknown
  }
  edit?: GenerationEditIntent
  regeneration?: GenerationRegenerationIntent
  approvalResponses?: GenerationApprovalResponse[]
  /** SHA-256 hex digest of the run-scoped worker secret (ADR-0011). */
  grantDigest?: string
}

export async function prepareGenerationForChat(
  ctx: MutationCtx,
  args: PrepareGenerationForChatArgs
) {
  const owner = await requireOwnedChat(ctx, args.chatId)
  const now = nowMs()
  const approvalResponses = args.approvalResponses ?? []

  if (args.edit && args.regeneration) {
    throw new Error("Regeneration cannot be combined with edit generation")
  }

  if (args.regeneration && args.latestUserMessage) {
    throw new Error("Regeneration cannot include a latest user message")
  }

  if ((args.edit || args.regeneration) && approvalResponses.length > 0) {
    throw new Error("Generation cannot continue pending approvals")
  }

  const latestUserMessage = args.edit
    ? args.edit.replacementMessage
    : args.regeneration
      ? undefined
      : args.latestUserMessage

  if (latestUserMessage && !args.edit) {
    await validateSelectedPathTokenForChat(ctx, args.chatId, {
      expectedVisibleMessageCount: args.expectedVisibleMessageCount,
      tailMessageId: args.tailMessageId,
    })
  }

  await closeSupersededGenerationsForChat(ctx, args.chatId, owner.user._id, now)

  const continuation = await applyApprovalResponses(ctx, owner, approvalResponses)
  const continuationMessage = continuation?.message ?? null

  if (latestUserMessage) {
    await denyPendingApprovalsForChat(
      ctx,
      args.chatId,
      owner.user._id,
      "auto-denied: new generation started"
    )

    if (args.edit) {
      await applyEditIntentForGeneration(
        ctx,
        owner,
        {
          chatId: args.chatId,
          requestId: args.requestId,
          model: args.model,
          provider: args.provider,
          edit: args.edit,
        },
        now
      )
    } else {
      await selectOrInsertLatestUserMessageForGeneration(
        ctx,
        owner,
        args,
        latestUserMessage as StoredUserMessage,
        now
      )
    }
  }

  const runId = await ctx.db.insert("generationRuns", {
    chatId: args.chatId,
    userId: owner.user._id,
    requestId: args.requestId,
    model: args.model,
    provider: args.provider,
    status: "running",
    startedAt: now,
    updatedAt: now,
    // The lease is born at prepare (gameplan §6): the worker's heartbeat loop
    // renews it; the reaper fails runs whose deadline lapses.
    heartbeatAt: now,
    leaseExpiresAt: computeLeaseExpiresAt(now),
    lastProgressAt: now,
    ...(args.grantDigest
      ? {
          grantDigest: args.grantDigest,
          grantExpiresAt: now + EXECUTION_GRANT_TTL_MS,
        }
      : {}),
  })

  let assistantMessageId: Id<"messages">
  let assistantOrder: number
  let includeAssistantInModelHistory = false
  let preparedModelHistory: Doc<"messages">[] | null = null

  if (args.regeneration) {
    const preparedRegeneration = await applyRegenerationIntentForGeneration(
      ctx,
      owner,
      {
        chatId: args.chatId,
        requestId: args.requestId,
        model: args.model,
        provider: args.provider,
        runId,
        regeneration: args.regeneration,
      },
      now
    )
    assistantMessageId = preparedRegeneration.assistantMessageId
    assistantOrder = preparedRegeneration.assistantOrder
    preparedModelHistory = preparedRegeneration.messages
  } else if (continuationMessage) {
    // Approval-continuation idempotency, layer 1 of 3 (gameplan §10, PR 8):
    // the paused run records its continuation inside this transaction, so of
    // two racing auto-send continuations exactly ONE creates a run — the
    // second sees continuationRunId and gets a typed conflict the route maps
    // to a structured 409 the client swallows. Anchored on the APPROVALS' run
    // (the message's generationRunId is re-pointed by the first winner).
    const pausedRunId = continuation?.pausedRunId ?? null
    if (pausedRunId && pausedRunId !== runId) {
      const pausedRun = await ctx.db.get(pausedRunId)
      if (pausedRun && pausedRun.chatId === args.chatId) {
        if (pausedRun.continuationRunId !== undefined) {
          console.log(
            JSON.stringify({
              _tag: "run_continuation_conflict",
              chatId: args.chatId,
              pausedRunId,
              reason: "already-dispatched",
              winnerRunId: pausedRun.continuationRunId,
            })
          )
          throw new ConvexError({
            code: "approval_continuation_conflict",
            message: "Approval continuation already dispatched",
          })
        }
        // A continuation is only legal against a pause that was still LIVE
        // when this prepare began (gameplan §9/§13 race #16 — "no approval
        // can resurrect a stopped run"). `pausedRunWasLive` is stamped by
        // applyApprovalResponses above: its approvals-resolved close
        // transitioned the pause in THIS transaction. False means an earlier
        // writer (Stop denying the approvals, supersession, reap) already
        // settled it — a late auto-send POST must conflict, not create a new
        // streaming run that re-claims the chat slot, repaints the settled
        // assistant message, and re-approves invocations the Stop denied.
        // The ConvexError rolls back this whole transaction — approval
        // repaints included.
        if (!continuation?.pausedRunWasLive) {
          console.log(
            JSON.stringify({
              _tag: "run_continuation_conflict",
              chatId: args.chatId,
              pausedRunId,
              reason: "pause-settled",
              pausedRunStatus: pausedRun.status,
            })
          )
          throw new ConvexError({
            code: "approval_continuation_conflict",
            message: "Approval pause already settled",
          })
        }
        // Belt-and-suspenders slot check: a pause that lost the chat's status
        // slot to a newer run must not let its continuation's supersede sweep
        // abort that healthy run mid-stream.
        if (
          owner.chat.statusRunId !== undefined &&
          owner.chat.statusRunId !== pausedRunId
        ) {
          console.log(
            JSON.stringify({
              _tag: "run_continuation_conflict",
              chatId: args.chatId,
              pausedRunId,
              reason: "slot-moved",
              slotRunId: owner.chat.statusRunId,
            })
          )
          throw new ConvexError({
            code: "approval_continuation_conflict",
            message: "Approval pause no longer owns the chat's active run",
          })
        }
        await ctx.db.patch(pausedRunId, { continuationRunId: runId })
        await ctx.db.patch(runId, { continuedFromRunId: pausedRunId })
      }
    }
    assistantMessageId = continuationMessage._id
    assistantOrder = continuationMessage.orderId
    includeAssistantInModelHistory = true
    await ctx.db.patch(assistantMessageId, {
      generationRunId: runId,
      requestId: args.requestId,
      status: "streaming",
      updatedAt: now,
    })
  } else {
    const assistantMessage = await createMessageBranchWriter(ctx, {
      chatId: args.chatId,
      now,
    }).writeAssistantPlaceholder({
      generationRunId: runId,
      requestId: args.requestId,
      model: args.model,
      provider: args.provider,
    })
    assistantMessageId = assistantMessage._id
    assistantOrder = assistantMessage.orderId
  }

  await ctx.db.patch(runId, {
    status: "streaming",
    assistantMessageId,
    activeStreamId: assistantMessageId,
    updatedAt: now,
  })
  // Claim the chat's status slot for this run (run start → live spinner). This
  // runs AFTER closeSupersededGenerationsForChat above, so the new run owns the
  // slot; the run-scoped guard then makes any older run's late terminal a no-op.
  // Direct write (not projectRunStatusToChat): claiming SETS statusRunId, so it
  // must not be gated on already owning the slot.
  await patchChatActivity(
    ctx,
    owner.chat,
    {
      liveRunStatus: "streaming",
      statusRunId: runId,
      // Written ONCE here (and overwritten only by an approval pause): the
      // hard ceiling no legitimate run outlives (gameplan §18 #4).
      liveRunFreshUntil: computeLiveRunFreshUntil(now),
    },
    now
  )

  const modelHistory =
    preparedModelHistory ??
    projectModelHistoryMessages(
      getSelectedPath(await listMessages(ctx, args.chatId)).filter(
        (message) =>
          includeAssistantInModelHistory || message._id !== assistantMessageId
      )
    )

  return {
    runId,
    assistantMessageId,
    assistantOrder,
    messages: modelHistory,
  }
}

export const prepareGeneration = mutation({
  args: {
    chatId: v.id("chats"),
    requestId: v.string(),
    model: v.string(),
    provider: v.string(),
    expectedVisibleMessageCount: v.optional(v.number()),
    tailMessageId: v.optional(v.string()),
    latestUserMessage: v.optional(vStoredMessage),
    edit: v.optional(vEditIntent),
    regeneration: v.optional(vRegenerationIntent),
    approvalResponses: v.optional(v.array(vApprovalResponse)),
    grantDigest: v.optional(v.string()),
  },
  handler: async (ctx, args) => prepareGenerationForChat(ctx, args),
})

export const updateAssistantSnapshot = ownedGenerationRunMutation({
  args: generationRunWriteArgs.updateAssistantSnapshot,
  handler: async (ctx, args) =>
    updateAssistantSnapshotForChat(
      ctx,
      { user: ctx.user, chat: ctx.chat, run: ctx.run },
      args
    ),
})

export async function updateAssistantSnapshotForChat(
  ctx: MutationCtx,
  owner: AuthenticatedRunOwner,
  args: {
    messageId: Id<"messages">
    order: number
    stepOrder?: number
    sequence: number
    textSnapshot: string
    partsSnapshot: unknown
    delta?: string
    payload?: unknown
  }
) {
  const { run } = owner
  const message = await requireAssistantMessageForRun(ctx, run, args.messageId)

  // A terminal run accepts no further snapshots. A streamer that lost the
  // abort/supersede race must become read-only here — its continued writes
  // to the run and message docs are what OCC-starve the next turn's
  // prepareGeneration on the same chat.
  if (isTerminalGenerationRunStatus(run.status)) {
    return { kind: "lost" as const, reason: "terminal" as const }
  }

  // Stale snapshots are rejected BEFORE persistence (gameplan §10 "Snapshot
  // sequencing"): a late lower-or-equal sequence write inserts nothing — the
  // old post-insert latest-snapshot check only prevented adoption, leaving a
  // dead row and a write conflict surface behind.
  const lastSequence = run.lastSnapshotSequence ?? 0
  if (args.sequence <= lastSequence) {
    return { kind: "stale" as const, lastSequence }
  }

  // Write-storm guard: a checkpoint whose content is byte-identical to what the
  // message already carries advances the sequence but must not rewrite the
  // (potentially large) message doc. Historical storms wrote identical
  // ~7 KB checkpoints at ~59 ms cadence for minutes; the sequence guard cannot
  // reject them because sequences advance.
  const contentUnchanged =
    message.content === args.textSnapshot &&
    JSON.stringify(message.parts) === JSON.stringify(args.partsSnapshot)

  const now = nowMs()
  // Rollback seam (delete after one green production cycle): setting
  // RETAIN_ROUTINE_SNAPSHOT_ROWS=1 in the Convex deployment env restores
  // historical row retention without any other behavior change.
  if (process.env.RETAIN_ROUTINE_SNAPSHOT_ROWS === "1") {
    await ctx.db.insert("assistantMessageSnapshots", {
      runId: run._id,
      chatId: run.chatId,
      messageId: args.messageId,
      order: args.order,
      stepOrder: args.stepOrder ?? 0,
      sequence: args.sequence,
      format: args.payload ? "UIMessageChunk" : "text_snapshot",
      delta: args.delta,
      payload: args.payload,
      textSnapshot: args.textSnapshot,
      partsSnapshot: args.partsSnapshot,
      createdAt: now,
    })
  }

  if (!isTerminalMessageStatus(message.status)) {
    // Status advances to "streaming" only while the worker still owns
    // execution. An awaiting_approval pause is lease-free (gameplan §6) and
    // its liveness is the pending approval — the same worker's post-pause
    // final flush lands CONTENT here, but repainting the pause "streaming"
    // would strand the run outside both liveness regimes (no lease → the
    // reaper's expiry range skips it; no pending-approval status → the
    // approval reaper skips it): a permanent zombie if the completion
    // downgrade write never arrives.
    const workerExecuting = isWorkerExecutingStatus(run.status)
    if (!contentUnchanged) {
      await ctx.db.patch(args.messageId, {
        content: args.textSnapshot,
        parts: args.partsSnapshot,
        ...(workerExecuting && { status: "streaming" as const }),
        updatedAt: now,
      })
    }
    await ctx.db.patch(run._id, {
      ...(workerExecuting && { status: "streaming" as const }),
      lastSnapshotSequence: args.sequence,
      lastProgressAt: now,
      updatedAt: now,
    })
  } else {
    // The message already settled (its half of a terminal is stamped) but the
    // run has not — record the accepted sequence so later stale writes still
    // reject pre-insert.
    await ctx.db.patch(run._id, {
      lastSnapshotSequence: args.sequence,
      lastProgressAt: now,
      updatedAt: now,
    })
  }
  return { kind: "applied" as const, deduped: contentUnchanged }
}

/**
 * The heartbeat's three-way discriminant (gameplan §6): the runtime MUST
 * branch on it — `renewed` continues the loop, `paused` stops the loop
 * WITHOUT aborting (the approval worker's envelope finalize is still
 * legitimate), `lost` aborts provider consumption and stops all writes.
 */
export type GenerationRunHeartbeatResult =
  | { kind: "renewed"; leaseExpiresAt: number }
  | { kind: "paused" }
  | { kind: "lost"; reason: "terminal" | "unlinked" | "not-owner" }

/**
 * Renew the worker's lease (worker-wire only — heartbeats have no user-token
 * twin; gameplan §0 amendment 1). Guards per the §10 matrix: exact run (the
 * grant), worker-executing status, run→message→chat linkage, and current
 * chat-slot ownership. Extends the run's lease fields only — never the chat
 * doc (§18 #4). Server clock, never a client timestamp.
 */
export async function heartbeatGenerationRunForChat(
  ctx: MutationCtx,
  owner: AuthenticatedRunOwner
): Promise<GenerationRunHeartbeatResult> {
  const { chat, run } = owner
  if (run.status === "awaiting_approval") return { kind: "paused" }
  if (!isWorkerExecutingStatus(run.status)) {
    return { kind: "lost", reason: "terminal" }
  }

  const activeStreamMessageId =
    run.activeStreamId === undefined
      ? null
      : ctx.db.normalizeId("messages", run.activeStreamId)
  const messageId = run.assistantMessageId ?? activeStreamMessageId
  const message = messageId ? await ctx.db.get(messageId) : null
  if (
    !message ||
    message.chatId !== run.chatId ||
    message.role !== "assistant" ||
    !isAssistantMessageLinkedToRun(message, run)
  ) {
    return { kind: "lost", reason: "unlinked" }
  }

  if (chat.statusRunId !== run._id) return { kind: "lost", reason: "not-owner" }

  const now = nowMs()
  const leaseExpiresAt = computeLeaseExpiresAt(now)
  await ctx.db.patch(run._id, {
    heartbeatAt: now,
    leaseExpiresAt,
    updatedAt: now,
  })
  return { kind: "renewed", leaseExpiresAt }
}

export const markGenerationRunCompleted = ownedGenerationRunMutation({
  args: generationRunWriteArgs.markGenerationRunCompleted,
  handler: async (ctx, args) =>
    markGenerationRunCompletedForChat(
      ctx,
      { user: ctx.user, chat: ctx.chat, run: ctx.run },
      args
    ),
})

export async function markGenerationRunCompletedForChat(
  ctx: MutationCtx,
  owner: AuthenticatedRunOwner,
  args: {
    messageId: Id<"messages">
    content: string
    parts: unknown
    metadata?: PersistedMessageMetadata
    finishReason?: string
    usage?: {
      inputTokens?: number
      outputTokens?: number
      totalTokens?: number
    }
    totalToolCalls?: number
    failedToolCalls?: number
  }
) {
  const { run } = owner
  // The first-terminal-wins guard and the completed-vs-awaiting_approval shape
  // live in the Generation run lifecycle's `complete` rule. `hasPendingApprovals`
  // is fact-gathering for it; the message payload (content/parts/metadata/usage)
  // and the run's usage/toolCounts stay here — the module decides status only.
  // Gate before gathering: the ignore decision reads only the run status, and
  // the already-terminal case is the racing duplicate this guard exists for.
  if (isIgnoredSignal(run.status, "complete")) return
  const hasPendingApprovals =
    (await ctx.db
      .query("toolApprovalRequests")
      .withIndex("by_run_status", (q) =>
        q.eq("runId", run._id).eq("status", "pending")
      )
      .first()) !== null
  const verdict = resolveGenerationRunTransition(
    { runStatus: run.status, message: null },
    { kind: "complete", hasPendingApprovals }
  )
  if (verdict.kind === "ignore") return
  await requireAssistantMessageForRun(ctx, run, args.messageId)
  const now = nowMs()
  const status = verdict.message.status

  await ctx.db.patch(args.messageId, {
    content: args.content,
    parts: args.parts,
    metadata: args.metadata,
    status,
    finishReason: args.finishReason,
    usage: args.usage,
    updatedAt: now,
  })
  await ctx.db.patch(run._id, {
    status: verdict.run.status,
    completedAt: verdict.run.settle ? now : undefined,
    updatedAt: now,
    finishReason: args.finishReason,
    inputTokens: args.usage?.inputTokens,
    outputTokens: args.usage?.outputTokens,
    totalToolCalls: args.totalToolCalls,
    failedToolCalls: args.failedToolCalls,
    activeStreamId: undefined,
    ...(verdict.run.terminalReason
      ? { terminalReason: verdict.run.terminalReason }
      : {}),
    // Both outcomes shed the lease: completed is terminal; the
    // awaiting_approval downgrade is the lease-free pause.
    ...LEASE_CLEAR,
  })
  // Completion patches the run directly (not via applyLifecycleVerdict), so the
  // projection is hooked here. verdict.run.status is "completed", or
  // "awaiting_approval" when the finish still has pending approvals.
  await projectRunStatusToChat(ctx, run, verdict.run.status, now)
}

export const markGenerationRunFailed = ownedGenerationRunMutation({
  args: generationRunWriteArgs.markGenerationRunFailed,
  handler: async (ctx, args) =>
    markGenerationRunFailedForChat(
      ctx,
      { user: ctx.user, chat: ctx.chat, run: ctx.run },
      args
    ),
})

export async function markGenerationRunFailedForChat(
  ctx: MutationCtx,
  owner: AuthenticatedRunOwner,
  args: {
    messageId?: Id<"messages">
    error: string
  }
) {
  const { run } = owner
  const now = nowMs()
  // Failed may overwrite completed but never aborted — the Generation run
  // lifecycle's `fail` rule owns that convergence and the message half. Gate
  // before gathering: the ignore decision reads only the run status, and the
  // already-settled case is the racing duplicate this rule absorbs.
  if (isIgnoredSignal(run.status, "fail")) return
  const resolved = await gatherAssistantMessageFacts(ctx, run, args.messageId)
  const verdict = resolveGenerationRunTransition(
    { runStatus: run.status, message: resolved?.facts ?? null },
    { kind: "fail", error: args.error }
  )
  if (verdict.kind === "ignore") return
  await applyLifecycleVerdict(ctx, run, verdict, resolved, now)
}

export const markGenerationRunAborted = ownedGenerationRunMutation({
  args: generationRunWriteArgs.markGenerationRunAborted,
  handler: async (ctx, args) =>
    markGenerationRunAbortedForChat(
      ctx,
      { user: ctx.user, chat: ctx.chat, run: ctx.run },
      args
    ),
})

export async function markGenerationRunAbortedForChat(
  ctx: MutationCtx,
  owner: AuthenticatedRunOwner,
  args: {
    messageId?: Id<"messages">
    reason?: string
  }
) {
  const { run } = owner
  const now = nowMs()
  // First-terminal-wins and the empty-placeholder policy both live in the
  // Generation run lifecycle's `abort` rule. Gate before gathering: the ignore
  // decision reads only the run status, and the double-terminal race (onAbort
  // vs envelope finish) is exactly where the gather reads would be wasted.
  if (isIgnoredSignal(run.status, "abort")) return
  const resolved = await gatherAssistantMessageFacts(ctx, run, args.messageId)
  const verdict = resolveGenerationRunTransition(
    { runStatus: run.status, message: resolved?.facts ?? null },
    { kind: "abort", reason: args.reason }
  )
  if (verdict.kind === "ignore") return
  await applyLifecycleVerdict(ctx, run, verdict, resolved, now)
}

export const createToolApprovalRequest = ownedGenerationRunMutation({
  args: generationRunWriteArgs.createToolApprovalRequest,
  handler: async (ctx, args) =>
    createToolApprovalRequestForChat(
      ctx,
      { user: ctx.user, chat: ctx.chat, run: ctx.run },
      args
    ),
})

export async function createToolApprovalRequestForChat(
  ctx: MutationCtx,
  owner: AuthenticatedRunOwner,
  args: {
    assistantMessageId: Id<"messages">
    toolCallId: string
    toolName: string
    source: Doc<"toolApprovalRequests">["source"]
    reason?: string
    riskClass: string
    inputPreview?: string
    approvalId: string
  }
): Promise<Id<"toolApprovalRequests"> | null> {
  const { user, run } = owner

  const existing = await ctx.db
    .query("toolApprovalRequests")
    .withIndex("by_approval", (q) => q.eq("approvalId", args.approvalId))
    .unique()
  if (existing) {
    if (
      existing.chatId !== run.chatId ||
      existing.runId !== run._id ||
      existing.assistantMessageId !== args.assistantMessageId
    ) {
      throw new Error("Approval request does not belong to this run")
    }
  }

  // Bug fix: a late approval request landing on an already-settled run — a user
  // Stop that raced the stream's approval-persistence transform — must not
  // repaint the run awaiting_approval (not supersedable, it would zombie until
  // the next turn's deny-pending pass), nor insert a pending row that would feed
  // hasPendingApprovals on a future completion. The Generation run lifecycle's
  // `approval-requested` rule ignores terminal runs; on ignore we insert nothing
  // and return null. Both API-runtime callers fire-and-forget this write and
  // never consume the returned id, so null is a no-op for them.
  const verdict = resolveGenerationRunTransition(
    { runStatus: run.status, message: null },
    { kind: "approval-requested" }
  )
  if (verdict.kind === "ignore") return null

  await requireAssistantMessageForRun(ctx, run, args.assistantMessageId)
  if (existing) return existing._id

  const now = nowMs()
  const approvalExpiresAt = now + APPROVAL_EXPIRY_MS
  const approvalRequestId = await ctx.db.insert("toolApprovalRequests", {
    chatId: run.chatId,
    runId: run._id,
    assistantMessageId: args.assistantMessageId,
    userId: user._id,
    toolCallId: args.toolCallId,
    toolName: args.toolName,
    source: args.source,
    reason: args.reason,
    riskClass: args.riskClass,
    inputPreview: truncatePreview(args.inputPreview),
    approvalId: args.approvalId,
    status: "pending",
    createdAt: now,
    expiresAt: approvalExpiresAt,
  })

  await ctx.db.patch(run._id, {
    status: verdict.run.status,
    updatedAt: now,
    lastProgressAt: now,
    // The pause is lease-free (gameplan §6): liveness becomes the pending
    // unexpired approval; the same worker's final flush and completion
    // downgrade stay legal via the non-terminal content-write guard.
    ...LEASE_CLEAR,
  })
  await ctx.db.patch(args.assistantMessageId, {
    status: verdict.message.status,
    updatedAt: now,
  })
  // The approval-request pause patches the run directly (not via
  // applyLifecycleVerdict), so project the awaiting phase here — carrying the
  // pause's freshness deadline (the approval expiry) onto the chat doc.
  await projectRunStatusToChat(ctx, run, verdict.run.status, now, {
    liveRunFreshUntil: approvalExpiresAt,
  })

  return approvalRequestId
}

// ---------------------------------------------------------------------------
// Durable Stop (gameplan §9, PR 6): authenticated, idempotent, explicitly
// run-scoped — Stop targets `(chatId, runId)`, never "the active run".
// ---------------------------------------------------------------------------

export type StopGenerationRunResult = {
  outcome: "stopped" | "already-terminal" | "not-current"
  status: GenerationRunStatus
  terminalReason?: Doc<"generationRuns">["terminalReason"]
}

export async function stopGenerationRunForChat(
  ctx: MutationCtx,
  owner: AuthenticatedRunOwner
): Promise<StopGenerationRunResult> {
  // Structural run ownership (CONTEXT.md "Authenticated handler"): the caller
  // resolves the chat THROUGH the run (`ownedGenerationRunMutation` /
  // `requireOwnedGenerationRun`), so a mismatched chat/run pair is
  // unrepresentable here — no hand-written cross-check.
  const { run } = owner

  // Idempotent second Stop / lost race against completion or failure: the
  // first committed terminal wins; return its canonical result.
  if (isTerminalGenerationRunStatus(run.status)) {
    return {
      outcome: "already-terminal",
      status: run.status,
      terminalReason: run.terminalReason,
    }
  }

  // A run that lost the chat's status slot is already terminal or is an
  // awaiting_approval run the next prepare's deny-pending pass closes —
  // never stop the newer owner (§9 step 5).
  if (owner.chat.statusRunId !== run._id) {
    return {
      outcome: "not-current",
      status: run.status,
      terminalReason: run.terminalReason,
    }
  }

  const now = nowMs()
  const reason = "stopped by user"
  const resolved = await gatherAssistantMessageFacts(ctx, run, undefined)
  const verdict = resolveGenerationRunTransition(
    { runStatus: run.status, message: resolved?.facts ?? null },
    { kind: "stop", reason }
  )
  if (verdict.kind !== "transition") {
    return {
      outcome: "already-terminal",
      status: run.status,
      terminalReason: run.terminalReason,
    }
  }

  // Lifecycle apply: message half (partial content preserved / stub policy),
  // run terminal fields (user_stop + grant revocation + lease shed), and the
  // owner-guarded chat projection clear — one shared path.
  await applyLifecycleVerdict(ctx, run, verdict, resolved, now)
  await ctx.db.patch(run._id, {
    stopRequestedAt: now,
    stopRequestedBy: owner.user._id,
  })

  // Deny this run's pending approvals; settle its active tool records
  // without erasing completed evidence (§9 steps 10–11).
  const pendingApprovals = await ctx.db
    .query("toolApprovalRequests")
    .withIndex("by_run_status", (q) =>
      q.eq("runId", run._id).eq("status", "pending")
    )
    .collect()
  for (const approval of pendingApprovals) {
    await ctx.db.patch(approval._id, {
      status: "denied",
      resolvedAt: now,
      resolvedByUserId: owner.user._id,
      reason,
    })
  }
  const invocations = await ctx.db
    .query("toolInvocations")
    .withIndex("by_run", (q) => q.eq("runId", run._id))
    .collect()
  for (const invocation of invocations) {
    if (terminalToolInvocationStatuses.has(invocation.status)) continue
    await ctx.db.patch(invocation._id, {
      status: invocation.status === "pending_approval" ? "denied" : "failed",
      error: reason,
      completedAt: now,
      updatedAt: now,
    })
  }

  console.log(
    JSON.stringify({
      _tag: "run_stop_won",
      runId: run._id,
      chatId: run.chatId,
      fromStatus: run.status,
    })
  )

  return { outcome: "stopped", status: "aborted", terminalReason: "user_stop" }
}

export const stopGenerationRun = ownedGenerationRunMutation({
  args: {},
  handler: async (ctx) =>
    stopGenerationRunForChat(ctx, {
      user: ctx.user,
      chat: ctx.chat,
      run: ctx.run,
    }),
})

/**
 * Approval resolution transitions ONLY `pending → approved|denied` (gameplan
 * §10, PR 8): a conflicting second decision — the other tab already resolved
 * — returns the canonical existing resolution instead of overwriting it (the
 * old unconditional patch let a late deny repaint an earlier approve).
 */
export type ToolCallDecisionResult = {
  status: "approved" | "denied" | "expired"
  alreadyResolved: boolean
  /** The CANONICAL persisted reason — the winner's, not the caller's. */
  reason?: string
}

/**
 * The ONE transactional approval-expiry operation. Both a user decision at or
 * after the deadline and the cron reaper use it, so whichever transaction
 * commits first produces the same approval, invocation, run, message, and chat
 * projection. Removing the approval from the pending index without settling
 * the paused run would otherwise strand it forever outside the reaper.
 */
async function expireToolApprovalForChat(
  ctx: MutationCtx,
  approval: Doc<"toolApprovalRequests">,
  now: number,
  source: "decision" | "reaper"
): Promise<boolean> {
  if (
    approval.status !== "pending" ||
    approval.expiresAt === undefined ||
    now < approval.expiresAt
  ) {
    return false
  }

  await ctx.db.patch(approval._id, { status: "expired", resolvedAt: now })

  const run = await ctx.db.get(approval.runId)
  if (!run) return true
  const invocation = await ctx.db
    .query("toolInvocations")
    .withIndex("by_run_tool_call", (q) =>
      q.eq("runId", run._id).eq("toolCallId", approval.toolCallId)
    )
    .unique()
  if (invocation && !terminalToolInvocationStatuses.has(invocation.status)) {
    await ctx.db.patch(invocation._id, {
      status: "failed",
      error: "tool approval expired",
      completedAt: now,
      updatedAt: now,
    })
  }

  const resolved = await gatherAssistantMessageFacts(ctx, run, undefined)
  const verdict = resolveGenerationRunTransition(
    { runStatus: run.status, message: resolved?.facts ?? null },
    { kind: "approval-expired" }
  )
  if (verdict.kind === "transition") {
    await applyLifecycleVerdict(ctx, run, verdict, resolved, now)
    await settleAuxiliaryRecordsForTerminalRun(
      ctx,
      run,
      "tool approval expired",
      now
    )
  }
  console.log(
    JSON.stringify({
      _tag: source === "reaper" ? "run_stale_reaped" : "run_approval_expired",
      reason: "approval_expired",
      source,
      runId: run._id,
      chatId: run.chatId,
      approvalId: approval.approvalId,
    })
  )
  return true
}

export async function resolveToolCallDecision(
  ctx: MutationCtx,
  args: { approvalId: string; reason?: string },
  decision: "approved" | "denied"
): Promise<ToolCallDecisionResult> {
  const user = await getCurrentUser(ctx)
  if (!user) throw new Error("Not authenticated")

  const approval = await ctx.db
    .query("toolApprovalRequests")
    .withIndex("by_approval", (q) => q.eq("approvalId", args.approvalId))
    .unique()
  if (!approval || approval.userId !== user._id) {
    throw new Error("Approval not found")
  }

  if (approval.status !== "pending") {
    return {
      status: approval.status as "approved" | "denied" | "expired",
      alreadyResolved: true,
      reason: approval.reason,
    }
  }

  const now = nowMs()

  // Expiry is checked TRANSACTIONALLY against the server clock, not left to
  // the cron: a decision racing in after `expiresAt` settles the row as
  // expired here — approving expired work must be impossible regardless of
  // reaper cadence (gameplan §10).
  if (approval.expiresAt !== undefined && now >= approval.expiresAt) {
    await expireToolApprovalForChat(ctx, approval, now, "decision")
    return { status: "expired", alreadyResolved: true, reason: approval.reason }
  }

  await ctx.db.patch(approval._id, {
    status: decision,
    resolvedAt: now,
    resolvedByUserId: user._id,
    reason: args.reason ?? approval.reason,
  })
  return {
    status: decision,
    alreadyResolved: false,
    reason: args.reason ?? approval.reason,
  }
}

export const approveToolCall = mutation({
  args: {
    approvalId: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => resolveToolCallDecision(ctx, args, "approved"),
})

export const denyToolCall = mutation({
  args: {
    approvalId: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => resolveToolCallDecision(ctx, args, "denied"),
})

export const recordToolInvocations = ownedGenerationRunMutation({
  args: generationRunWriteArgs.recordToolInvocations,
  handler: async (ctx, args) =>
    recordToolInvocationsForChat(
      ctx,
      { user: ctx.user, chat: ctx.chat, run: ctx.run },
      args
    ),
})

export async function recordToolInvocationsForChat(
  ctx: MutationCtx,
  owner: AuthenticatedRunOwner,
  args: {
    messageId: Id<"messages">
    stepNumber?: number
    invocations: Array<{
      toolCallId: string
      toolName: string
      source: Doc<"toolInvocations">["source"]
      input?: unknown
      output?: unknown
      error?: string
      status: Doc<"toolInvocations">["status"]
      approvalRequestId?: string
    }>
  }
) {
  const { run } = owner
  await requireAssistantMessageForRun(ctx, run, args.messageId)

  // A terminal run accepts no further tool-invocation writes — the same
  // read-only rule the snapshot path enforces (gameplan §10 guard matrix; this
  // was the one worker op that still accepted writes after settlement). The
  // late writer here is a worker that lost the abort/supersede race flushing
  // its step records.
  if (isTerminalGenerationRunStatus(run.status)) return

  const now = nowMs()

  for (const invocation of args.invocations) {
    const existing = await ctx.db
      .query("toolInvocations")
      .withIndex("by_run_tool_call", (q) =>
        q.eq("runId", run._id).eq("toolCallId", invocation.toolCallId)
      )
      .unique()

    const approval = invocation.approvalRequestId
      ? await ctx.db
          .query("toolApprovalRequests")
          .withIndex("by_approval", (q) =>
            q.eq("approvalId", invocation.approvalRequestId!)
          )
          .unique()
      : null
    if (approval) {
      if (
        approval.chatId !== run.chatId ||
        approval.runId !== run._id ||
        approval.assistantMessageId !== args.messageId
      ) {
        throw new Error("Approval request does not belong to this run")
      }
    } else if (invocation.approvalRequestId) {
      throw new Error("Approval request not found for run")
    }

    const patch = {
      messageId: args.messageId,
      toolName: invocation.toolName,
      source: invocation.source,
      input: invocation.input,
      inputPreview: truncatePreview(invocation.input),
      output: invocation.output,
      outputPreview: truncatePreview(invocation.output),
      error: invocation.error ? truncatePreview(invocation.error) : undefined,
      status: invocation.status,
      approvalId: approval?._id,
      approvalRequestId: invocation.approvalRequestId,
      stepNumber: args.stepNumber,
      completedAt:
        invocation.status === "completed" ||
        invocation.status === "failed" ||
        invocation.status === "denied"
          ? now
          : undefined,
      updatedAt: now,
    }

    if (existing) {
      await ctx.db.patch(existing._id, patch)
    } else {
      await ctx.db.insert("toolInvocations", {
        runId: run._id,
        chatId: run.chatId,
        toolCallId: invocation.toolCallId,
        createdAt: now,
        ...patch,
      })
    }
  }

  if (args.invocations.length > 0) {
    // Accepted tool activity is progress evidence (gameplan §5) — not
    // liveness; the heartbeat alone renews the lease.
    await ctx.db.patch(run._id, { lastProgressAt: now, updatedAt: now })
  }
}

// ---------------------------------------------------------------------------
// Reconciliation reapers (durable-turn gameplan §6, PR 3). Internal MUTATIONS
// (transactional, exactly-once per invocation — never actions), invoked by
// convex/crons.ts. Bounded per status per tick (REAPER_BATCH_LIMIT); the
// next tick finishes what this one left.
//
// Load-bearing range shape (§18 #6): Convex orders `undefined < null < all
// other values`, and documents missing an indexed field sort as `undefined` —
// so every expiry range MUST exclude `undefined` via `.gt(field, undefined)`
// or pre-heartbeat rows (no lease fields) would be falsely reaped.
//
// Deploy-boundary drain rule (§6): enable these crons only after every
// in-flight run started by a pre-heartbeat deploy has drained. With the
// `undefined` exclusion this is belt-and-suspenders; pre-launch it is
// trivially satisfied (dev data is disposable).
// ---------------------------------------------------------------------------

// Modest by design: each reaped run also settles its auxiliary records
// (pending approvals + non-terminal tool invocations) inside the SAME
// transaction, so the per-tick write volume is candidates × per-run records.
// An oversized batch that trips Convex transaction limits fails atomically
// and would re-select the identical oldest candidates every tick — permanent
// starvation. 25 keeps a pathological backlog draining incrementally
// (25/status/tick at a 15 s cadence clears thousands per hour).
const REAPER_BATCH_LIMIT = 25

/**
 * Settle the auxiliary records a terminal run leaves behind: pending
 * approvals expire; non-terminal tool invocations fail. Partial assistant
 * content is preserved by the lifecycle's terminal message policy — never
 * erased here.
 * The per-run collects are unbounded queries over naturally bounded sets:
 * both tables are keyed by runId, and one run accrues at most a handful of
 * approvals and step-count-bounded invocations (maxSteps caps the stream).
 */
async function settleAuxiliaryRecordsForTerminalRun(
  ctx: MutationCtx,
  run: Doc<"generationRuns">,
  error: string,
  now: number
) {
  const pendingApprovals = await ctx.db
    .query("toolApprovalRequests")
    .withIndex("by_run_status", (q) =>
      q.eq("runId", run._id).eq("status", "pending")
    )
    .collect()
  for (const approval of pendingApprovals) {
    await ctx.db.patch(approval._id, { status: "expired", resolvedAt: now })
  }

  const invocations = await ctx.db
    .query("toolInvocations")
    .withIndex("by_run", (q) => q.eq("runId", run._id))
    .collect()
  for (const invocation of invocations) {
    if (terminalToolInvocationStatuses.has(invocation.status)) continue
    await ctx.db.patch(invocation._id, {
      status: "failed",
      error,
      completedAt: now,
      updatedAt: now,
    })
  }
}

/**
 * Fail runs whose worker lease lapsed. Every candidate is validated inside
 * this transaction: the indexed read IS the transactional state (Convex
 * mutations are serializable — a concurrently renewing heartbeat conflicts
 * and one of the two retries against the other's committed state), and the
 * lifecycle's `lease-expired` rule re-checks worker-executing status. A
 * reaped run becomes failed/lease_expired — never fake-completed — with
 * partial content preserved.
 */
export async function reapExpiredGenerationRunsPass(
  ctx: MutationCtx
): Promise<{ reaped: number }> {
  {
    const now = nowMs()
    let reaped = 0
    for (const status of ["running", "streaming"] as const) {
      const candidates = await ctx.db
        .query("generationRuns")
        .withIndex("by_status_lease_expires", (q) =>
          q
            .eq("status", status)
            .gt("leaseExpiresAt", undefined)
            .lt("leaseExpiresAt", now)
        )
        .take(REAPER_BATCH_LIMIT)
      for (const run of candidates) {
        // Belt-and-suspenders re-validation of the fields the range implies.
        if (run.leaseExpiresAt === undefined || run.leaseExpiresAt >= now) {
          continue
        }
        const resolved = await gatherAssistantMessageFacts(ctx, run, undefined)
        const verdict = resolveGenerationRunTransition(
          { runStatus: run.status, message: resolved?.facts ?? null },
          { kind: "lease-expired" }
        )
        if (verdict.kind !== "transition") continue
        await applyLifecycleVerdict(ctx, run, verdict, resolved, now)
        await settleAuxiliaryRecordsForTerminalRun(
          ctx,
          run,
          "generation worker lease expired",
          now
        )
        reaped++
        console.log(
          JSON.stringify({
            _tag: "run_stale_reaped",
            runId: run._id,
            chatId: run.chatId,
            status,
            heartbeatAt: run.heartbeatAt,
            leaseExpiresAt: run.leaseExpiresAt,
            ageMs: run.startedAt === undefined ? null : now - run.startedAt,
          })
        )
      }
    }
    return { reaped }
  }
}

export const reapExpiredGenerationRuns = internalMutation({
  args: {},
  handler: async (ctx) => reapExpiredGenerationRunsPass(ctx),
})

/**
 * Expire approval pauses nobody resolved. The pending approval row settles as
 * `expired`; its run (if still paused) fails with `approval_expired` through
 * the lifecycle rule, preserving the pre-approval content tail.
 */
export async function reapExpiredToolApprovalsPass(
  ctx: MutationCtx
): Promise<{ expired: number }> {
  {
    const now = nowMs()
    let expired = 0
    const candidates = await ctx.db
      .query("toolApprovalRequests")
      .withIndex("by_status_expires", (q) =>
        q
          .eq("status", "pending")
          .gt("expiresAt", undefined)
          .lte("expiresAt", now)
      )
      .take(REAPER_BATCH_LIMIT)
    for (const approval of candidates) {
      if (approval.expiresAt === undefined || approval.expiresAt > now) {
        continue
      }
      if (await expireToolApprovalForChat(ctx, approval, now, "reaper")) {
        expired++
      }
    }
    return { expired }
  }
}

export const reapExpiredToolApprovals = internalMutation({
  args: {},
  handler: async (ctx) => reapExpiredToolApprovalsPass(ctx),
})
