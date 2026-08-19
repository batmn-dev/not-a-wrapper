import { v } from "convex/values"
import type { Doc, Id } from "./_generated/dataModel"
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
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
 * ONE branch context (plan PR 1 step 3; made unconditional in the 2026-07-23
 * flag collapse after hash-identical equivalence held across every fixture).
 */
function getVisibleSelectedMessages(messages: Doc<"messages">[]) {
  const context = createBranchContext(messages)
  return withBranchMetadata(
    getSelectedPathMessagesFromContext(context).filter(isVisibleChatMessage),
    (message) => getBranchInfoForMessageFromContext(context, message)
  )
}

/**
 * Run/worker correlation ids are owner-internal plumbing (durable-turn
 * gameplan §7): a public or non-owner viewer gets the conversation, never the
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

// Atomic selected-conversation projection (durable-turn gameplan §7, PR 4).

const ACTIVE_TOOL_INVOCATION_STATUSES = new Set<
  Doc<"toolInvocations">["status"]
>(["called", "pending_approval", "approved"])

export type PendingApprovalProjection = {
  approvalId: string
  toolCallId: string
  toolName: string
  source: Doc<"toolApprovalRequests">["source"]
  reason?: string
  riskClass: string
  inputPreview?: string
  assistantMessageId: Id<"messages">
  createdAt: number
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
  lastSnapshotSequence?: number
  lastProgressAt?: number
  activeToolNames: string[]
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

  // Tool/approval reads only for the validated run.
  const invocations = await ctx.db
    .query("toolInvocations")
    .withIndex("by_run", (q) => q.eq("runId", run._id))
    .collect()
  const activeToolNames = [
    ...new Set(
      invocations
        .filter((invocation) =>
          ACTIVE_TOOL_INVOCATION_STATUSES.has(invocation.status)
        )
        .map((invocation) => invocation.toolName)
    ),
  ]
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
      lastSnapshotSequence: run.lastSnapshotSequence,
      lastProgressAt: run.lastProgressAt,
      activeToolNames,
      pendingApproval: pendingApproval
        ? {
            approvalId: pendingApproval.approvalId,
            toolCallId: pendingApproval.toolCallId,
            toolName: pendingApproval.toolName,
            source: pendingApproval.source,
            reason: pendingApproval.reason,
            riskClass: pendingApproval.riskClass,
            inputPreview: pendingApproval.inputPreview,
            assistantMessageId: pendingApproval.assistantMessageId,
            createdAt: pendingApproval.createdAt,
            expiresAt: pendingApproval.expiresAt,
          }
        : null,
    },
  }
}

/**
 * The owner's atomic selected conversation (messages + linked run). Replaces
 * `getForChat` as the authenticated client's primary subscription — do NOT
 * wrap `getForChat` with an independent run subscription; that reintroduces
 * torn combinations.
 */
export const getSelectedConversation = readableChatQuery({
  args: {},
  handler: async (ctx) =>
    getSelectedConversationForViewer(ctx, {
      chat: ctx.chat,
      viewer: ctx.user,
    }),
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
