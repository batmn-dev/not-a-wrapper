import { v } from "convex/values"
import type { Doc, Id } from "./_generated/dataModel"
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import {
  bucketPow2,
  logChatPerfConvex,
  shouldSampleChatPerfConvex,
} from "./domain/chat_perf"
import { createMessageBranchWriter } from "./domain/message_branch_writes"
import {
  createBranchContext,
  getBranchInfoForMessageFromContext,
  getSelectedPathMessagesFromContext,
  type MessageBranchInfo,
} from "./domain/message_branches"
import {
  extractTextFromMessageParts,
  normalizeMessagePartsForStorage,
} from "./domain/message_parts"
import { isVisibleChatMessage } from "./domain/message_visibility"
import { recordChatActivity } from "./domain/project_activity"
import {
  getAuthorizedChatForRead,
  getCurrentUser,
  isChatActive,
  requireOwnedChat,
} from "./lib/auth"
import { ownedChatMutation, readableChatQuery } from "./lib/authedFunctions"

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
  selectedMessages: Doc<"messages">[],
  getBranchInfo: (message: Doc<"messages">) => MessageBranchInfo | undefined
) {
  return selectedMessages.map((message) => {
    const branch = getBranchInfo(message)
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

/**
 * Selected visible path plus branch descriptors. The whole projection shares
 * one branch context.
 */
function getVisibleSelectedMessages(messages: Doc<"messages">[]) {
  const context = createBranchContext(messages)
  return withBranchMetadata(
    getSelectedPathMessagesFromContext(context).filter(isVisibleChatMessage),
    (message) => getBranchInfoForMessageFromContext(context, message)
  )
}

/**
 * Run/worker correlation ids are owner-internal plumbing: a public or
 * non-owner viewer gets the conversation, never the
 * generation-run linkage that keys durable control state. Both fields are
 * optional on the doc, so omitting them preserves the handler return type.
 */
function stripRunLinkageForViewer<
  T extends { generationRunId?: unknown; requestId?: unknown },
>(messages: T[]): T[] {
  return messages.map((message) => {
    const { generationRunId: _run, requestId: _request, ...rest } = message
    return rest as unknown as T
  })
}

async function isChatOwner(
  ctx: QueryCtx,
  chat: Doc<"chats">
): Promise<boolean> {
  const viewer = await getCurrentUser(ctx)
  return viewer !== null && chat.userId === viewer._id
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
  const visible = getVisibleSelectedMessages(messages)
  if (await isChatOwner(ctx, chat)) return visible
  return stripRunLinkageForViewer(visible)
}

export async function getPublicForChatHandler(
  ctx: QueryCtx,
  { chatId }: { chatId: Id<"chats"> }
) {
  const chat = await ctx.db.get(chatId)
  if (!chat || !chat.public || !(await isChatActive(ctx, chat))) return []

  const messages = await listMessagesByChatOrder(ctx, chatId)
  return stripRunLinkageForViewer(
    getVisibleSelectedMessages(messages).filter(
      (message) => message.status !== "awaiting_approval"
    )
  )
}

export async function getLastMessagesHandler(
  ctx: QueryCtx,
  { chatId, limit = 2 }: { chatId: Id<"chats">; limit?: number }
) {
  const chat = await getAuthorizedChatForRead(ctx, chatId)
  if (!chat) return []

  const messages = await listMessagesByChatOrder(ctx, chatId)
  const tail = getVisibleSelectedMessages(messages).slice(-limit)
  if (await isChatOwner(ctx, chat)) return tail
  return stripRunLinkageForViewer(tail)
}

// Atomic selected-conversation projection.

// (ACTIVE_TOOL_INVOCATION_STATUSES removed with `activeToolNames` —
// Experiment 2 §6.1.)

/**
 * Slimmed to the fields the client actually consumes (Experiment 2 §6.1):
 * presence + expiry drive the awaiting-approval presentation; the approval
 * UI itself is driven from message parts and the approve/deny mutations,
 * never from this projection. The dropped fields (approvalId, toolCallId,
 * toolName, source, reason, riskClass, inputPreview, createdAt) had zero
 * production consumers and made the wire value churn.
 */
export type PendingApprovalProjection = {
  expiresAt?: number
}

/**
 * Raw durable facts about the chat's current run — deliberately `selectedRun`,
 * not `activeRun`: `statusRunId` is kept after a terminal transition, so the
 * UI receives the linked terminal status/reason during convergence. NO
 * time-derived fields cross this wire (freshness, controllable, stoppable):
 * Convex queries re-execute on data changes, never on wall-clock time — a
 * server-classified freshness could never expire between writes (§18 #3). The
 * client resolver owns all clock classification.
 */
export type SelectedRunProjection = {
  runId: Id<"generationRuns">
  assistantMessageId: Id<"messages">
  status: Doc<"generationRuns">["status"]
  terminalReason?: Doc<"generationRuns">["terminalReason"]
  leaseExpiresAt?: number
  // Experiment 2 §6.1: lastSnapshotSequence / lastProgressAt /
  // activeToolNames removed — zero production consumers, and the first two
  // changed on EVERY snapshot beat, forcing a full re-delivery of this
  // projection (and, in the atomic query, of the whole selected path) for
  // content-free run-doc writes.
  pendingApproval: PendingApprovalProjection | null
}

export type SelectedConversationProjection = {
  selectedMessages: Awaited<ReturnType<typeof getForChatHandler>>
  selectedRun: SelectedRunProjection | null
}

/**
 * The owner's primary selected-message subscription: selected visible path
 * AND the linked current run in ONE query transaction, so content and run
 * state can never tear. Public and non-owner viewers receive `selectedRun:
 * null` — no run IDs, lease times, or approval capabilities leak. Guest/local
 * chats never reach this query (no runs; the provider keeps its
 * persistence-mode gating).
 */
export async function getSelectedConversationForViewer(
  ctx: QueryCtx,
  {
    chat,
    viewer,
  }: { chat: Doc<"chats"> | null; viewer: Doc<"users"> | null }
): Promise<SelectedConversationProjection> {
  // Auth-free core (CONTEXT.md "Authenticated handler"): the caller resolves
  // `chat` (owner-or-public) and `viewer` through the readableChatQuery
  // builder — this body never touches ctx.auth.
  if (!chat) return { selectedMessages: [], selectedRun: null }

  const messages = await listMessagesByChatOrder(ctx, chat._id)
  const selectedMessages = getVisibleSelectedMessages(messages)

  // Sampled read-cost telemetry (measurement plan Phase 2 §2.3): rows read
  // vs rows returned and the projected parts size, buckets only. A logged
  // line marks a real (uncached) execution, so line frequency doubles as the
  // re-execution/invalidation counter this query never had.
  if (shouldSampleChatPerfConvex()) {
    let partsBytes = 0
    try {
      partsBytes = JSON.stringify(
        selectedMessages.map((message) => message.parts)
      ).length
    } catch {
      // Size estimate only.
    }
    logChatPerfConvex("selected_conversation_read", {
      messagesReadBucket: bucketPow2(messages.length),
      selectedCountBucket: bucketPow2(selectedMessages.length),
      partsBytesBucket: bucketPow2(partsBytes),
    })
  }

  const isOwner = viewer !== null && chat.userId === viewer._id
  if (!isOwner) {
    // Message docs carry the run linkage too — a public viewer must not read
    // run ids out of `selectedMessages` after `selectedRun` was nulled. The
    // awaiting_approval filter matches the public share-page read: a pending
    // approval's tool name/args are the owner's business until resolved.
    return {
      selectedMessages: stripRunLinkageForViewer(
        selectedMessages.filter(
          (message) => message.status !== "awaiting_approval"
        )
      ),
      selectedRun: null,
    }
  }
  if (!chat.statusRunId) {
    return { selectedMessages, selectedRun: null }
  }

  // Validation gauntlet (§7): the run must belong to this chat and owner,
  // its assistant message must sit on the selected path, and the message must
  // point back at the same run. Any mismatch returns no run rather than a
  // torn or misattributed one.
  const run = await ctx.db.get(chat.statusRunId)
  if (
    !run ||
    run.chatId !== chat._id ||
    (run.userId !== undefined && run.userId !== chat.userId)
  ) {
    return { selectedMessages, selectedRun: null }
  }
  const assistantMessageId = run.assistantMessageId
  if (!assistantMessageId) return { selectedMessages, selectedRun: null }
  const onSelectedPath = selectedMessages.some(
    (message) => message._id === assistantMessageId
  )
  const linkedMessage = messages.find(
    (message) => message._id === assistantMessageId
  )
  const pointsBack =
    linkedMessage !== undefined &&
    (linkedMessage.generationRunId === run._id ||
      run.activeStreamId === linkedMessage._id)
  if (!onSelectedPath || !pointsBack) {
    return { selectedMessages, selectedRun: null }
  }

  // Approval read only for the validated run (Experiment 2 §6.1: the
  // toolInvocations collect is gone with `activeToolNames`).
  const pendingApproval = await ctx.db
    .query("toolApprovalRequests")
    .withIndex("by_run_status", (q) =>
      q.eq("runId", run._id).eq("status", "pending")
    )
    .first()

  return {
    selectedMessages,
    selectedRun: {
      runId: run._id,
      assistantMessageId,
      status: run.status,
      terminalReason: run.terminalReason,
      leaseExpiresAt: run.leaseExpiresAt,
      pendingApproval: pendingApproval
        ? { expiresAt: pendingApproval.expiresAt }
        : null,
    },
  }
}

export type SelectedPathProjection = {
  selectedMessages: SelectedConversationProjection["selectedMessages"]
  /**
   * Cheap reconciliation fingerprint derived from the data this execution
   * read — no schema change, sufficient for client-side consistency
   * assertions, NOT a server-side gate.
   */
  pathVersion: {
    count: number
    tailMessageId: Id<"messages"> | null
    maxUpdatedAt: number
  }
}

/**
 * Experiment 2 split, message half: the selected visible path and NOTHING
 * run-shaped. Its Convex read set is chats/projects/users/messages only, so
 * run-doc writes (deduped snapshot beats, heartbeats, tool steps, approval
 * bookkeeping) no longer re-execute the full message collect. Derivation is
 * byte-identical to the atomic query — same collect, same branch context —
 * so branch/sibling/legacy semantics cannot diverge.
 */
export async function getSelectedPathForViewer(
  ctx: QueryCtx,
  {
    chat,
    viewer,
  }: { chat: Doc<"chats"> | null; viewer: Doc<"users"> | null }
): Promise<SelectedPathProjection> {
  const empty: SelectedPathProjection = {
    selectedMessages: [],
    pathVersion: { count: 0, tailMessageId: null, maxUpdatedAt: 0 },
  }
  if (!chat) return empty
  const messages = await listMessagesByChatOrder(ctx, chat._id)
  const selectedMessages = getVisibleSelectedMessages(messages)

  if (shouldSampleChatPerfConvex()) {
    let partsBytes = 0
    try {
      partsBytes = JSON.stringify(
        selectedMessages.map((message) => message.parts)
      ).length
    } catch {
      // Size estimate only.
    }
    logChatPerfConvex("selected_conversation_read", {
      messagesReadBucket: bucketPow2(messages.length),
      selectedCountBucket: bucketPow2(selectedMessages.length),
      partsBytesBucket: bucketPow2(partsBytes),
    })
  }

  const isOwner = viewer !== null && chat.userId === viewer._id
  const visibleMessages = isOwner
    ? selectedMessages
    : stripRunLinkageForViewer(
        selectedMessages.filter(
          (message) => message.status !== "awaiting_approval"
        )
      )
  return {
    selectedMessages: visibleMessages,
    pathVersion: {
      count: visibleMessages.length,
      tailMessageId: visibleMessages.at(-1)?._id ?? null,
      maxUpdatedAt: visibleMessages.reduce(
        (max, message) => Math.max(max, message.updatedAt ?? 0),
        0
      ),
    },
  }
}

/**
 * Experiment 2 split, run half: the tiny per-beat state. Owner-only (public
 * and non-owner viewers get null, as the atomic query gave them). The §7
 * validation gauntlet is split across the seam: run↔chat ownership and the
 * points-back check stay HERE (one linked-message get); the on-selected-path
 * half moves to the client, which is sound because both split queries'
 * values always come from one Convex transition (same client, same
 * `chatId`-only arguments) — the provider nulls the run when its assistant
 * message is absent from the delivered path.
 */
export async function getSelectedRunStateForViewer(
  ctx: QueryCtx,
  {
    chat,
    viewer,
  }: { chat: Doc<"chats"> | null; viewer: Doc<"users"> | null }
): Promise<SelectedRunProjection | null> {
  if (!chat) return null
  const isOwner = viewer !== null && chat.userId === viewer._id
  if (!isOwner) return null
  if (!chat.statusRunId) return null

  const run = await ctx.db.get(chat.statusRunId)
  if (
    !run ||
    run.chatId !== chat._id ||
    (run.userId !== undefined && run.userId !== chat.userId)
  ) {
    return null
  }
  const assistantMessageId = run.assistantMessageId
  if (!assistantMessageId) return null
  // Points-back short-circuit (Experiment 2 finding 1): while the run is
  // live, `activeStreamId` IS the linked message id (stamped at stream start,
  // cleared on terminal transitions), so the back-pointer is decidable from
  // the run doc alone. Reading the message here would not only cost the
  // growing live doc per execution — it would put the message in this query's
  // READ SET, re-executing the run half on every content beat and erasing
  // the split's point. The message read remains only as the settled-run
  // fallback (`generationRunId` stamp), where the doc is no longer written
  // per beat. Divergence from the atomic query: when `activeStreamId`
  // matches, the linked message's existence is not verified — a dangling id
  // can never appear in the delivered path, so the client's on-path check
  // nulls exactly the cases the atomic query's existence check caught.
  let pointsBack = run.activeStreamId === assistantMessageId
  if (!pointsBack) {
    const linkedMessage = await ctx.db.get(assistantMessageId)
    pointsBack =
      linkedMessage !== null && linkedMessage.generationRunId === run._id
  }
  if (!pointsBack) return null

  const pendingApproval = await ctx.db
    .query("toolApprovalRequests")
    .withIndex("by_run_status", (q) =>
      q.eq("runId", run._id).eq("status", "pending")
    )
    .first()

  return {
    runId: run._id,
    assistantMessageId,
    status: run.status,
    terminalReason: run.terminalReason,
    leaseExpiresAt: run.leaseExpiresAt,
    pendingApproval: pendingApproval
      ? { expiresAt: pendingApproval.expiresAt }
      : null,
  }
}

/**
 * The owner's atomic selected conversation (messages + linked run). Since
 * Experiment 2 this is the ROLLBACK path behind the split pair below; the
 * historical "do NOT wrap `getForChat` with an independent run subscription"
 * warning is discharged for the split pair specifically because a Convex
 * client applies every subscribed query's update from one transition
 * atomically (browser/sync/remote_query_set) — two `chatId`-keyed queries on
 * one client can never deliver values from different database timestamps.
 * Independent subscriptions with arguments derived from ANOTHER query's
 * result remain forbidden; that is real tearing.
 */
export const getSelectedConversation = readableChatQuery({
  args: {},
  handler: async (ctx) =>
    getSelectedConversationForViewer(ctx, {
      chat: ctx.chat,
      viewer: ctx.user,
    }),
})

/** Experiment 2 split, message half — see getSelectedPathForViewer. */
export const getSelectedPath = readableChatQuery({
  args: {},
  handler: async (ctx) =>
    getSelectedPathForViewer(ctx, { chat: ctx.chat, viewer: ctx.user }),
})

/** Experiment 2 split, run half — see getSelectedRunStateForViewer. */
export const getSelectedRunState = readableChatQuery({
  args: {},
  handler: async (ctx) =>
    getSelectedRunStateForViewer(ctx, { chat: ctx.chat, viewer: ctx.user }),
})

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
  const { chat } = await requireOwnedChat(ctx, chatId)

  const targetMessage = await ctx.db.get(messageId)
  if (!targetMessage || targetMessage.chatId !== chatId) {
    throw new Error("Message not found")
  }

  const now = Date.now()
  await createMessageBranchWriter(ctx, { chatId, now }).select(targetMessage._id)

  await recordChatActivity(ctx, chat, now)
  return targetMessage._id
}

export const selectBranch = mutation({
  args: {
    chatId: v.id("chats"),
    messageId: v.id("messages"),
  },
  handler: selectBranchForChat,
})

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

    const now = Date.now()
    await recordChatActivity(ctx, ctx.chat, now)
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

    const now = Date.now()
    await recordChatActivity(ctx, ctx.chat, now)

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
