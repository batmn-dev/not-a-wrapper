import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"
import type { Doc, Id } from "./_generated/dataModel"
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import {
  clearSiblingSelectionForMutation,
  getNextBranchIndexForMutation,
  normalizeSelectedBranchPathForMutation,
  selectMessageSiblingForMutation,
} from "./domain/message_branch_writes"
import {
  getEffectiveParentId,
  getSelectedPathMessages,
  getSiblingMessages,
} from "./domain/message_branches"
import {
  isActiveGenerationRunStatus,
  isTerminalGenerationRunStatus,
  isTerminalMessageStatus,
} from "./domain/message_contract"
import { extractTextFromMessageParts } from "./domain/message_parts"
import {
  hasSemanticAssistantParts,
  isModelHistoryMessage,
  isVisibleChatMessage,
} from "./domain/message_visibility"
import { getAuthorizedChatForRead, getCurrentUser } from "./lib/auth"

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

type AuthenticatedOwner = {
  user: Doc<"users">
  chat: Doc<"chats">
}

const ACTIVE_RUN_SCAN_LIMIT = 50
const RECOVERABLE_RUN_SCAN_LIMIT = 10

const terminalToolInvocationStatuses = new Set<
  Doc<"toolInvocations">["status"]
>(["denied", "completed", "failed"])

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

async function requireChatOwner(
  ctx: QueryCtx | MutationCtx,
  chatId: Id<"chats">
): Promise<AuthenticatedOwner> {
  const user = await getCurrentUser(ctx)
  if (!user) throw new Error("Not authenticated")

  const chat = await ctx.db.get(chatId)
  if (!chat || chat.userId !== user._id) {
    throw new Error("Not authorized")
  }

  return { user, chat }
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

async function getNextOrder(ctx: MutationCtx, chatId: Id<"chats">) {
  const latest = await ctx.db
    .query("messages")
    .withIndex("by_chat_order", (q) => q.eq("chatId", chatId))
    .order("desc")
    .first()
  return latest ? latest.orderId + 1 : 0
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

function getVisibleSelectedMessages(messages: Doc<"messages">[]) {
  return getSelectedPathMessages(messages).filter(isVisibleChatMessage)
}

function getLastSelectedMessage(messages: Doc<"messages">[]) {
  const selectedMessages = getSelectedPathMessages(messages)
  return selectedMessages[selectedMessages.length - 1]
}

function validateSelectedPathToken(
  messages: Doc<"messages">[],
  token: SelectedPathToken
) {
  if (token.expectedVisibleMessageCount === undefined) {
    throw new Error("Selected path token required")
  }

  const selectedMessages = getVisibleSelectedMessages(messages)
  if (selectedMessages.length !== token.expectedVisibleMessageCount) {
    throw new Error("Stale chat state: selected path changed")
  }

  const tailMessage = selectedMessages[selectedMessages.length - 1]
  const actualTailMessageId = tailMessage?._id

  if (
    token.tailMessageId !== undefined &&
    actualTailMessageId !== token.tailMessageId
  ) {
    throw new Error("Stale chat state: selected path changed")
  }
}

async function validateSelectedPathTokenForChat(
  ctx: MutationCtx,
  chatId: Id<"chats">,
  token: SelectedPathToken
) {
  validateSelectedPathToken(await listMessages(ctx, chatId), token)
}

async function selectFallbackSiblingBeforeDelete(
  ctx: MutationCtx,
  message: Doc<"messages">,
  now: number
) {
  if (message.selected !== true) return

  const messages = await listMessages(ctx, message.chatId)
  const parentMessageId = getEffectiveParentId(messages, message)
  const siblings = getSiblingMessages(
    messages,
    parentMessageId,
    message.role
  ).filter((sibling) => sibling._id !== message._id)
  const fallbackSibling = siblings[siblings.length - 1]
  if (!fallbackSibling) return

  await selectMessageSiblingForMutation(ctx, messages, fallbackSibling, now)
}

type TerminalGenerationOutcome = {
  status: "aborted" | "failed"
  error?: string
}

function isSupersedableGenerationRunStatus(status: unknown): boolean {
  return status === "queued" || status === "running" || status === "streaming"
}

function isSupersedableMessageStatus(status: unknown): boolean {
  return status === "submitted" || status === "streaming"
}

async function applyTerminalAssistantOutcome(
  ctx: MutationCtx,
  run: Doc<"generationRuns">,
  messageId: Id<"messages"> | undefined,
  outcome: TerminalGenerationOutcome,
  now: number
): Promise<Id<"messages"> | undefined> {
  const resolvedMessageId =
    messageId ??
    run.assistantMessageId ??
    (run.activeStreamId as Id<"messages"> | undefined)
  if (!resolvedMessageId) return run.assistantMessageId

  const message = await ctx.db.get(resolvedMessageId)
  if (
    !message ||
    message.chatId !== run.chatId ||
    message.role !== "assistant"
  ) {
    return run.assistantMessageId
  }

  const isReusedAssistantForRegeneration =
    typeof run.startedAt === "number" && message.createdAt < run.startedAt
  if (isReusedAssistantForRegeneration) {
    const latestSnapshot = await ctx.db
      .query("assistantMessageSnapshots")
      .withIndex("by_run_sequence", (q) => q.eq("runId", run._id))
      .first()
    if (!latestSnapshot && hasSemanticAssistantParts(message)) {
      await ctx.db.patch(message._id, {
        status: "completed",
        error: undefined,
        updatedAt: now,
      })
      return message._id
    }
  }

  if (!hasSemanticAssistantParts(message)) {
    await selectFallbackSiblingBeforeDelete(ctx, message, now)
    await ctx.db.delete(message._id)
    return run.assistantMessageId === message._id
      ? undefined
      : run.assistantMessageId
  }

  await ctx.db.patch(message._id, {
    status: outcome.status,
    error: outcome.error,
    updatedAt: now,
  })
  return message._id
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
    if (!isSupersedableGenerationRunStatus(run.status)) continue
    if (run.userId !== undefined && run.userId !== userId) continue

    supersededRunIds.add(run._id)
    const assistantMessageId = await applyTerminalAssistantOutcome(
      ctx,
      run,
      undefined,
      { status: "aborted", error: reason },
      now
    )
    if (assistantMessageId) supersededMessageIds.add(assistantMessageId)

    await ctx.db.patch(run._id, {
      status: "aborted",
      error: reason,
      completedAt: now,
      updatedAt: now,
      activeStreamId: undefined,
      assistantMessageId,
    })
  }

  const assistantMessages = await ctx.db
    .query("messages")
    .withIndex("by_chat_role", (q) =>
      q.eq("chatId", chatId).eq("role", "assistant")
    )
    .collect()

  for (const message of assistantMessages) {
    if (supersededMessageIds.has(message._id)) continue
    if (!hasSemanticAssistantParts(message)) {
      await selectFallbackSiblingBeforeDelete(ctx, message, now)
      await ctx.db.delete(message._id)
      continue
    }

    if (!isSupersedableMessageStatus(message.status)) continue

    await ctx.db.patch(message._id, {
      status: "aborted",
      error: reason,
      updatedAt: now,
    })

    if (
      message.generationRunId &&
      !supersededRunIds.has(message.generationRunId)
    ) {
      const run = await ctx.db.get(message.generationRunId)
      if (
        run &&
        run.chatId === chatId &&
        isSupersedableGenerationRunStatus(run.status)
      ) {
        await ctx.db.patch(run._id, {
          status: "aborted",
          error: reason,
          completedAt: now,
          updatedAt: now,
          activeStreamId: undefined,
          assistantMessageId: message._id,
        })
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

async function insertUserMessageForGeneration(
  ctx: MutationCtx,
  owner: AuthenticatedOwner,
  args: {
    chatId: Id<"chats">
    requestId: string
    model: string
    provider: string
  },
  latestUserMessage: StoredUserMessage,
  now: number,
  branch: {
    parentMessageId: Id<"messages"> | undefined
    branchIndex: number
    selected: boolean
  }
): Promise<Id<"messages">> {
  const content =
    latestUserMessage.content ??
    extractTextFromMessageParts(latestUserMessage.parts)
  const order = await getNextOrder(ctx, args.chatId)

  return await ctx.db.insert("messages", {
    chatId: args.chatId,
    orderId: order,
    clientMessageId: latestUserMessage.id,
    userId: owner.user._id,
    role: "user",
    content,
    parts: latestUserMessage.parts,
    parentMessageId: branch.parentMessageId,
    branchIndex: branch.branchIndex,
    selected: branch.selected,
    status: "completed",
    requestId: args.requestId,
    model: args.model,
    provider: args.provider,
    createdAt: now,
    updatedAt: now,
  })
}

async function selectOrInsertLatestUserMessageForGeneration(
  ctx: MutationCtx,
  owner: AuthenticatedOwner,
  args: {
    chatId: Id<"chats">
    requestId: string
    model: string
    provider: string
  },
  latestUserMessage: StoredUserMessage,
  now: number,
  selectedPathToken: SelectedPathToken
) {
  let currentMessages = await normalizeSelectedBranchPathForMutation(
    ctx,
    await listMessages(ctx, args.chatId),
    now
  )
  validateSelectedPathToken(currentMessages, selectedPathToken)
  const alreadyStored = currentMessages.find(
    (message) =>
      message.role === "user" &&
      message.clientMessageId === latestUserMessage.id
  )

  if (alreadyStored) {
    await selectMessageSiblingForMutation(
      ctx,
      currentMessages,
      alreadyStored,
      now
    )
    return alreadyStored._id
  }

  const parentMessageId = getLastSelectedMessage(currentMessages)?._id
  currentMessages = await clearSiblingSelectionForMutation(
    ctx,
    currentMessages,
    parentMessageId,
    "user",
    now
  )

  return await insertUserMessageForGeneration(
    ctx,
    owner,
    args,
    latestUserMessage,
    now,
    {
      parentMessageId,
      branchIndex: getNextBranchIndexForMutation(
        currentMessages,
        parentMessageId,
        "user"
      ),
      selected: true,
    }
  )
}

export async function applyRegenerationIntentForGeneration(
  ctx: MutationCtx,
  owner: AuthenticatedOwner,
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
  let currentMessages = await normalizeSelectedBranchPathForMutation(
    ctx,
    await listMessages(ctx, args.chatId),
    now
  )
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

  const parentMessageId = getEffectiveParentId(currentMessages, targetMessage)
  currentMessages = await clearSiblingSelectionForMutation(
    ctx,
    currentMessages,
    parentMessageId,
    "assistant",
    now
  )
  const assistantOrder = await getNextOrder(ctx, args.chatId)
  const assistantMessageId = await ctx.db.insert("messages", {
    chatId: args.chatId,
    orderId: assistantOrder,
    role: "assistant",
    content: "",
    parts: [],
    parentMessageId,
    branchIndex: getNextBranchIndexForMutation(
      currentMessages,
      parentMessageId,
      "assistant"
    ),
    selected: true,
    status: "streaming",
    requestId: args.requestId,
    generationRunId: args.runId,
    model: args.model,
    provider: args.provider,
    createdAt: now,
    updatedAt: now,
  })

  return {
    assistantMessageId,
    assistantOrder,
    messages: selectedMessages
      .slice(0, pairedUserIndex + 1)
      .filter(isModelHistoryMessage),
  }
}

export async function applyEditIntentForGeneration(
  ctx: MutationCtx,
  owner: AuthenticatedOwner,
  args: {
    chatId: Id<"chats">
    requestId: string
    model: string
    provider: string
    edit: GenerationEditIntent
  },
  now: number
) {
  let currentMessages = await normalizeSelectedBranchPathForMutation(
    ctx,
    await listMessages(ctx, args.chatId),
    now
  )
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

  if (replacementMessage) {
    await selectMessageSiblingForMutation(
      ctx,
      currentMessages,
      replacementMessage,
      now
    )
  } else if (editedMessage) {
    const parentMessageId = getEffectiveParentId(currentMessages, editedMessage)
    currentMessages = await clearSiblingSelectionForMutation(
      ctx,
      currentMessages,
      parentMessageId,
      "user",
      now
    )
    await insertUserMessageForGeneration(
      ctx,
      owner,
      args,
      args.edit.replacementMessage,
      now,
      {
        parentMessageId,
        branchIndex: getNextBranchIndexForMutation(
          currentMessages,
          parentMessageId,
          "user"
        ),
        selected: true,
      }
    )
  }

  if (args.edit.title) {
    await ctx.db.patch(args.chatId, {
      title: args.edit.title,
      updatedAt: now,
    })
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
      (run.userId === undefined || run.userId === userId) &&
      !isTerminalGenerationRunStatus(run.status)
    ) {
      await ctx.db.patch(request.runId, {
        status: "aborted",
        error: reason,
        completedAt: now,
        updatedAt: now,
        activeStreamId: undefined,
      })
    }
  }
}

export async function applyApprovalResponses(
  ctx: MutationCtx,
  owner: AuthenticatedOwner,
  responses: Array<{
    messageId: string
    approvalId: string
    toolCallId: string
    toolName: string
    approved: boolean
    reason?: string
  }>
): Promise<Doc<"messages"> | null> {
  if (responses.length === 0) return null

  const messages = await listMessages(ctx, owner.chat._id)
  const messageById = new Map(messages.map((message) => [message._id, message]))
  let updatedMessage: Doc<"messages"> | null = null
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

  for (const [runId, runDecision] of runDecisions) {
    await ctx.db.patch(runId, {
      status: runDecision.denied ? "aborted" : "completed",
      completedAt: now,
      updatedAt: now,
      activeStreamId: undefined,
    })
  }

  return updatedMessage
}

export const createGenerationRun = mutation({
  args: {
    chatId: v.id("chats"),
    requestId: v.string(),
    model: v.string(),
    provider: v.string(),
    chatVersion: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireChatOwner(ctx, args.chatId)
    const now = nowMs()
    return await ctx.db.insert("generationRuns", {
      chatId: args.chatId,
      userId: user._id,
      requestId: args.requestId,
      model: args.model,
      provider: args.provider,
      status: "queued",
      chatVersion: args.chatVersion,
      updatedAt: now,
    })
  },
})

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
  chatVersion?: number
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
}

export async function prepareGenerationForChat(
  ctx: MutationCtx,
  args: PrepareGenerationForChatArgs
) {
  const owner = await requireChatOwner(ctx, args.chatId)
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

  const continuationMessage = await applyApprovalResponses(
    ctx,
    owner,
    approvalResponses
  )

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
        now,
        {
          expectedVisibleMessageCount: args.expectedVisibleMessageCount,
          tailMessageId: args.tailMessageId,
        }
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
    chatVersion: args.chatVersion,
    startedAt: now,
    updatedAt: now,
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
    let currentMessages = await normalizeSelectedBranchPathForMutation(
      ctx,
      await listMessages(ctx, args.chatId),
      now
    )
    const parentMessageId = getLastSelectedMessage(currentMessages)?._id
    currentMessages = await clearSiblingSelectionForMutation(
      ctx,
      currentMessages,
      parentMessageId,
      "assistant",
      now
    )
    assistantOrder = await getNextOrder(ctx, args.chatId)
    assistantMessageId = await ctx.db.insert("messages", {
      chatId: args.chatId,
      orderId: assistantOrder,
      role: "assistant",
      content: "",
      parts: [],
      parentMessageId,
      branchIndex: getNextBranchIndexForMutation(
        currentMessages,
        parentMessageId,
        "assistant"
      ),
      selected: true,
      status: "streaming",
      requestId: args.requestId,
      generationRunId: runId,
      model: args.model,
      provider: args.provider,
      createdAt: now,
      updatedAt: now,
    })
  }

  await ctx.db.patch(runId, {
    status: "streaming",
    assistantMessageId,
    activeStreamId: assistantMessageId,
    updatedAt: now,
  })
  await ctx.db.patch(args.chatId, { updatedAt: now })

  const modelHistory =
    preparedModelHistory ??
    getSelectedPathMessages(await listMessages(ctx, args.chatId)).filter(
      (message) =>
        (includeAssistantInModelHistory ||
          message._id !== assistantMessageId) &&
        isModelHistoryMessage(message)
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
    chatVersion: v.optional(v.number()),
    expectedVisibleMessageCount: v.optional(v.number()),
    tailMessageId: v.optional(v.string()),
    latestUserMessage: v.optional(vStoredMessage),
    edit: v.optional(vEditIntent),
    regeneration: v.optional(vRegenerationIntent),
    approvalResponses: v.optional(v.array(vApprovalResponse)),
  },
  handler: async (ctx, args) => prepareGenerationForChat(ctx, args),
})

export const markGenerationRunRunning = mutation({
  args: { runId: v.id("generationRuns") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId)
    if (!run) throw new Error("Run not found")
    await requireChatOwner(ctx, run.chatId)
    await ctx.db.patch(runId, { status: "running", updatedAt: nowMs() })
  },
})

export const updateAssistantSnapshot = mutation({
  args: {
    runId: v.id("generationRuns"),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    order: v.number(),
    stepOrder: v.optional(v.number()),
    sequence: v.number(),
    textSnapshot: v.string(),
    partsSnapshot: v.any(),
    delta: v.optional(v.string()),
    payload: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await requireChatOwner(ctx, args.chatId)
    const run = await ctx.db.get(args.runId)
    const message = await ctx.db.get(args.messageId)
    if (!run || run.chatId !== args.chatId) throw new Error("Run not found")
    if (!message || message.chatId !== args.chatId) {
      throw new Error("Message not found")
    }

    const now = nowMs()
    await ctx.db.insert("assistantMessageSnapshots", {
      runId: args.runId,
      chatId: args.chatId,
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

    if (!isTerminalMessageStatus(message.status)) {
      await ctx.db.patch(args.messageId, {
        content: args.textSnapshot,
        parts: args.partsSnapshot,
        status: "streaming",
        updatedAt: now,
      })
      await ctx.db.patch(args.runId, {
        status: "streaming",
        updatedAt: now,
      })
    }
  },
})

export const appendStreamDelta = updateAssistantSnapshot

export const markGenerationRunAwaitingApproval = mutation({
  args: {
    runId: v.id("generationRuns"),
    messageId: v.optional(v.id("messages")),
  },
  handler: async (ctx, args) =>
    markGenerationRunAwaitingApprovalForChat(ctx, args),
})

export async function markGenerationRunAwaitingApprovalForChat(
  ctx: MutationCtx,
  args: {
    runId: Id<"generationRuns">
    messageId?: Id<"messages">
  }
) {
  const run = await ctx.db.get(args.runId)
  if (!run) throw new Error("Run not found")
  await requireChatOwner(ctx, run.chatId)
  const messageId = args.messageId ?? run.assistantMessageId
  if (messageId) {
    await requireAssistantMessageForRun(ctx, run, messageId)
  }
  const now = nowMs()
  await ctx.db.patch(args.runId, {
    status: "awaiting_approval",
    updatedAt: now,
  })
  if (messageId) {
    await ctx.db.patch(messageId, {
      status: "awaiting_approval",
      updatedAt: now,
    })
  }
}

export const markGenerationRunCompleted = mutation({
  args: {
    runId: v.id("generationRuns"),
    messageId: v.id("messages"),
    content: v.string(),
    parts: v.any(),
    metadata: v.optional(v.any()),
    finishReason: v.optional(v.string()),
    usage: v.optional(vUsage),
    totalToolCalls: v.optional(v.number()),
    failedToolCalls: v.optional(v.number()),
  },
  handler: async (ctx, args) => markGenerationRunCompletedForChat(ctx, args),
})

export async function markGenerationRunCompletedForChat(
  ctx: MutationCtx,
  args: {
    runId: Id<"generationRuns">
    messageId: Id<"messages">
    content: string
    parts: unknown
    metadata?: unknown
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
  const run = await ctx.db.get(args.runId)
  if (!run) throw new Error("Run not found")
  await requireChatOwner(ctx, run.chatId)
  await requireAssistantMessageForRun(ctx, run, args.messageId)
  const now = nowMs()
  const hasPendingApprovals = await ctx.db
    .query("toolApprovalRequests")
    .withIndex("by_run_status", (q) =>
      q.eq("runId", args.runId).eq("status", "pending")
    )
    .first()
  const status = hasPendingApprovals ? "awaiting_approval" : "completed"

  await ctx.db.patch(args.messageId, {
    content: args.content,
    parts: args.parts,
    metadata: args.metadata,
    status,
    finishReason: args.finishReason,
    usage: args.usage,
    updatedAt: now,
  })
  await ctx.db.patch(args.runId, {
    status,
    completedAt: status === "completed" ? now : undefined,
    updatedAt: now,
    finishReason: args.finishReason,
    inputTokens: args.usage?.inputTokens,
    outputTokens: args.usage?.outputTokens,
    totalToolCalls: args.totalToolCalls,
    failedToolCalls: args.failedToolCalls,
    activeStreamId: undefined,
  })
  await ctx.db.patch(run.chatId, { updatedAt: now })
}

export const markGenerationRunFailed = mutation({
  args: {
    runId: v.id("generationRuns"),
    messageId: v.optional(v.id("messages")),
    error: v.string(),
  },
  handler: async (ctx, args) => markGenerationRunFailedForChat(ctx, args),
})

export async function markGenerationRunFailedForChat(
  ctx: MutationCtx,
  args: {
    runId: Id<"generationRuns">
    messageId?: Id<"messages">
    error: string
  }
) {
  const run = await ctx.db.get(args.runId)
  if (!run) throw new Error("Run not found")
  await requireChatOwner(ctx, run.chatId)
  const now = nowMs()
  const assistantMessageId = await applyTerminalAssistantOutcome(
    ctx,
    run,
    args.messageId,
    { status: "failed", error: args.error },
    now
  )
  await ctx.db.patch(args.runId, {
    status: "failed",
    error: args.error,
    completedAt: now,
    updatedAt: now,
    activeStreamId: undefined,
    assistantMessageId,
  })
}

export const markGenerationRunAborted = mutation({
  args: {
    runId: v.id("generationRuns"),
    messageId: v.optional(v.id("messages")),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => markGenerationRunAbortedForChat(ctx, args),
})

export async function markGenerationRunAbortedForChat(
  ctx: MutationCtx,
  args: {
    runId: Id<"generationRuns">
    messageId?: Id<"messages">
    reason?: string
  }
) {
  const run = await ctx.db.get(args.runId)
  if (!run) throw new Error("Run not found")
  await requireChatOwner(ctx, run.chatId)
  const now = nowMs()
  const assistantMessageId = await applyTerminalAssistantOutcome(
    ctx,
    run,
    args.messageId,
    { status: "aborted", error: args.reason },
    now
  )
  await ctx.db.patch(args.runId, {
    status: "aborted",
    error: args.reason,
    completedAt: now,
    updatedAt: now,
    activeStreamId: undefined,
    assistantMessageId,
  })
}

export const listMessagesForChatPaginated = query({
  args: {
    chatId: v.id("chats"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const chat = await getAuthorizedChatForRead(ctx, args.chatId)
    if (!chat) return { page: [], isDone: true, continueCursor: "" }

    const page = await ctx.db
      .query("messages")
      .withIndex("by_chat_order", (q) => q.eq("chatId", args.chatId))
      .paginate(args.paginationOpts)

    return {
      ...page,
      page: page.page.filter(isVisibleChatMessage),
    }
  },
})

export const listActiveRunsForChat = query({
  args: { chatId: v.id("chats") },
  handler: async (ctx, { chatId }) => {
    const chat = await getAuthorizedChatForRead(ctx, chatId)
    if (!chat) return []
    const runs = await ctx.db
      .query("generationRuns")
      .withIndex("by_chat_updated", (q) => q.eq("chatId", chatId))
      .order("desc")
      .take(ACTIVE_RUN_SCAN_LIMIT)
    return runs
      .filter((run) => isActiveGenerationRunStatus(run.status))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  },
})

export const listStreamDeltasForRun = query({
  args: { runId: v.id("generationRuns") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId)
    if (!run) return []
    await requireChatOwner(ctx, run.chatId)
    return await ctx.db
      .query("assistantMessageSnapshots")
      .withIndex("by_run_sequence", (q) => q.eq("runId", runId))
      .collect()
  },
})

export const getRecoverableChatState = query({
  args: { chatId: v.id("chats") },
  handler: async (ctx, { chatId }) => {
    const chat = await getAuthorizedChatForRead(ctx, chatId)
    if (!chat) return null

    const messages = (await listMessages(ctx, chatId)).filter(
      isVisibleChatMessage
    )
    const runs = await ctx.db
      .query("generationRuns")
      .withIndex("by_chat_updated", (q) => q.eq("chatId", chatId))
      .order("desc")
      .take(RECOVERABLE_RUN_SCAN_LIMIT)

    if (chat.public) {
      return {
        chat,
        messages: messages.filter((message) => message.status === "completed"),
        activeRuns: [],
        pendingApprovals: [],
      }
    }

    const user = await getCurrentUser(ctx)
    const pendingApprovals = user
      ? await ctx.db
          .query("toolApprovalRequests")
          .withIndex("by_user_status", (q) =>
            q.eq("userId", user._id).eq("status", "pending")
          )
          .collect()
      : []

    return {
      chat,
      messages,
      activeRuns: runs.filter((run) => isActiveGenerationRunStatus(run.status)),
      pendingApprovals: pendingApprovals.filter(
        (approval) => approval.chatId === chatId
      ),
    }
  },
})

export const createToolApprovalRequest = mutation({
  args: {
    chatId: v.id("chats"),
    runId: v.id("generationRuns"),
    assistantMessageId: v.id("messages"),
    toolCallId: v.string(),
    toolName: v.string(),
    source: vToolSource,
    reason: v.optional(v.string()),
    riskClass: v.string(),
    inputPreview: v.optional(v.string()),
    approvalId: v.string(),
  },
  handler: async (ctx, args) => createToolApprovalRequestForChat(ctx, args),
})

export async function createToolApprovalRequestForChat(
  ctx: MutationCtx,
  args: {
    chatId: Id<"chats">
    runId: Id<"generationRuns">
    assistantMessageId: Id<"messages">
    toolCallId: string
    toolName: string
    source: Doc<"toolApprovalRequests">["source"]
    reason?: string
    riskClass: string
    inputPreview?: string
    approvalId: string
  }
) {
  const { user } = await requireChatOwner(ctx, args.chatId)
  const run = await ctx.db.get(args.runId)
  if (!run || run.chatId !== args.chatId) throw new Error("Run not found")
  await requireAssistantMessageForRun(ctx, run, args.assistantMessageId)

  const existing = await ctx.db
    .query("toolApprovalRequests")
    .withIndex("by_approval", (q) => q.eq("approvalId", args.approvalId))
    .unique()
  if (existing) {
    if (
      existing.chatId !== args.chatId ||
      existing.runId !== args.runId ||
      existing.assistantMessageId !== args.assistantMessageId
    ) {
      throw new Error("Approval request does not belong to this run")
    }
    return existing._id
  }

  const now = nowMs()
  const approvalRequestId = await ctx.db.insert("toolApprovalRequests", {
    chatId: args.chatId,
    runId: args.runId,
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
  })

  await ctx.db.patch(args.runId, {
    status: "awaiting_approval",
    updatedAt: now,
  })
  await ctx.db.patch(args.assistantMessageId, {
    status: "awaiting_approval",
    updatedAt: now,
  })

  return approvalRequestId
}

export const approveToolCall = mutation({
  args: {
    approvalId: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx)
    if (!user) throw new Error("Not authenticated")

    const approval = await ctx.db
      .query("toolApprovalRequests")
      .withIndex("by_approval", (q) => q.eq("approvalId", args.approvalId))
      .unique()
    if (!approval || approval.userId !== user._id) {
      throw new Error("Approval not found")
    }

    const now = nowMs()
    await ctx.db.patch(approval._id, {
      status: "approved",
      resolvedAt: now,
      resolvedByUserId: user._id,
      reason: args.reason ?? approval.reason,
    })
    return approval._id
  },
})

export const denyToolCall = mutation({
  args: {
    approvalId: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx)
    if (!user) throw new Error("Not authenticated")

    const approval = await ctx.db
      .query("toolApprovalRequests")
      .withIndex("by_approval", (q) => q.eq("approvalId", args.approvalId))
      .unique()
    if (!approval || approval.userId !== user._id) {
      throw new Error("Approval not found")
    }

    const now = nowMs()
    await ctx.db.patch(approval._id, {
      status: "denied",
      resolvedAt: now,
      resolvedByUserId: user._id,
      reason: args.reason ?? approval.reason,
    })
    return approval._id
  },
})

export const recordToolInvocations = mutation({
  args: {
    runId: v.id("generationRuns"),
    chatId: v.id("chats"),
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
  handler: async (ctx, args) => recordToolInvocationsForChat(ctx, args),
})

export async function recordToolInvocationsForChat(
  ctx: MutationCtx,
  args: {
    runId: Id<"generationRuns">
    chatId: Id<"chats">
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
  await requireChatOwner(ctx, args.chatId)
  const run = await ctx.db.get(args.runId)
  if (!run || run.chatId !== args.chatId) throw new Error("Run not found")
  await requireAssistantMessageForRun(ctx, run, args.messageId)
  const now = nowMs()

  for (const invocation of args.invocations) {
    const existing = await ctx.db
      .query("toolInvocations")
      .withIndex("by_run_tool_call", (q) =>
        q.eq("runId", args.runId).eq("toolCallId", invocation.toolCallId)
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
        approval.chatId !== args.chatId ||
        approval.runId !== args.runId ||
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
        runId: args.runId,
        chatId: args.chatId,
        toolCallId: invocation.toolCallId,
        createdAt: now,
        ...patch,
      })
    }
  }
}
