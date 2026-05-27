import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"

const MAX_PREVIEW_LENGTH = 500

const vMessageRole = v.union(
  v.literal("user"),
  v.literal("assistant"),
  v.literal("system"),
  v.literal("data")
)

const vMessageStatus = v.union(
  v.literal("submitted"),
  v.literal("streaming"),
  v.literal("completed"),
  v.literal("aborted"),
  v.literal("failed"),
  v.literal("awaiting_approval")
)

const vRunStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("streaming"),
  v.literal("awaiting_approval"),
  v.literal("completed"),
  v.literal("aborted"),
  v.literal("failed")
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

const terminalMessageStatuses = new Set<Doc<"messages">["status"]>([
  "completed",
  "aborted",
  "failed",
])

const terminalRunStatuses = new Set<Doc<"generationRuns">["status"]>([
  "completed",
  "aborted",
  "failed",
])

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

async function getCurrentUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) return null

  return await ctx.db
    .query("users")
    .withIndex("by_workos_user_id", (q) =>
      q.eq("workosUserId", identity.subject)
    )
    .unique()
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

async function getAuthorizedChatForRead(
  ctx: QueryCtx,
  chatId: Id<"chats">
): Promise<Doc<"chats"> | null> {
  const chat = await ctx.db.get(chatId)
  if (!chat) return null
  if (chat.public) return chat

  const user = await getCurrentUser(ctx)
  if (!user || chat.userId !== user._id) return null
  return chat
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

function extractTextFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return ""
  let text = ""
  for (const part of parts) {
    if (
      part &&
      typeof part === "object" &&
      (part as { type?: unknown }).type === "text" &&
      typeof (part as { text?: unknown }).text === "string"
    ) {
      text += (part as { text: string }).text
    }
  }
  return text
}

function findMessageByUiId(
  messages: Doc<"messages">[],
  messageId: string
): Doc<"messages"> | undefined {
  return messages.find(
    (message) => message._id === messageId || message.clientMessageId === messageId
  )
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
    const associatedInvocations = [...invocationCandidates, ...runInvocations]
      .filter((invocation) => {
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
        ...(!terminalMessageStatuses.has(message.status)
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
      !terminalRunStatuses.has(run.status)
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

async function applyApprovalResponses(
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
  let updatedMessage: Doc<"messages"> | null = null
  const now = nowMs()

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

    const canonicalDecision = resolveCanonicalApprovalDecision(approval, response)

    const message = findMessageByUiId(messages, response.messageId)
    if (!message || message.chatId !== owner.chat._id) {
      throw new Error("Approval message not found")
    }

    const nextParts = applyApprovalResponseToParts(message.parts, {
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
    updatedMessage = refreshed ?? message

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

    await ctx.db.patch(approval.runId, {
      status: canonicalDecision.approved ? "completed" : "aborted",
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

export const prepareGeneration = mutation({
  args: {
    chatId: v.id("chats"),
    requestId: v.string(),
    model: v.string(),
    provider: v.string(),
    chatVersion: v.optional(v.number()),
    latestUserMessage: v.optional(vStoredMessage),
    approvalResponses: v.optional(v.array(vApprovalResponse)),
  },
  handler: async (ctx, args) => {
    const owner = await requireChatOwner(ctx, args.chatId)
    const now = nowMs()
    const approvalResponses = args.approvalResponses ?? []

    const continuationMessage = await applyApprovalResponses(
      ctx,
      owner,
      approvalResponses
    )

    if (args.latestUserMessage) {
      const latestUserMessage = args.latestUserMessage
      await denyPendingApprovalsForChat(
        ctx,
        args.chatId,
        owner.user._id,
        "auto-denied: new generation started"
      )

      const currentMessages = await listMessages(ctx, args.chatId)
      const alreadyStored =
        currentMessages.some(
          (message) => message.clientMessageId === latestUserMessage.id
        )

      if (!alreadyStored) {
        const content =
          latestUserMessage.content ??
          extractTextFromParts(latestUserMessage.parts)
        const order = await getNextOrder(ctx, args.chatId)
        await ctx.db.insert("messages", {
          chatId: args.chatId,
          orderId: order,
          clientMessageId: latestUserMessage.id,
          userId: owner.user._id,
          role: "user",
          content,
          parts: latestUserMessage.parts,
          status: "completed",
          requestId: args.requestId,
          model: args.model,
          provider: args.provider,
          createdAt: now,
          updatedAt: now,
        })
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

    if (continuationMessage) {
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
      assistantOrder = await getNextOrder(ctx, args.chatId)
      assistantMessageId = await ctx.db.insert("messages", {
        chatId: args.chatId,
        orderId: assistantOrder,
        role: "assistant",
        content: "",
        parts: [],
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

    const modelHistory = (await listMessages(ctx, args.chatId)).filter(
      (message) => includeAssistantInModelHistory || message._id !== assistantMessageId
    )

    return {
      runId,
      assistantMessageId,
      assistantOrder,
      messages: modelHistory,
    }
  },
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

    const terminalStatuses = new Set(["completed", "failed", "aborted"])
    if (!terminalStatuses.has(message.status)) {
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
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId)
    if (!run) throw new Error("Run not found")
    await requireChatOwner(ctx, run.chatId)
    const now = nowMs()
    await ctx.db.patch(args.runId, {
      status: "awaiting_approval",
      updatedAt: now,
    })
    const messageId = args.messageId ?? run.assistantMessageId
    if (messageId) {
      await ctx.db.patch(messageId, {
        status: "awaiting_approval",
        updatedAt: now,
      })
    }
  },
})

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
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId)
    if (!run) throw new Error("Run not found")
    await requireChatOwner(ctx, run.chatId)
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
  },
})

export const markGenerationRunFailed = mutation({
  args: {
    runId: v.id("generationRuns"),
    messageId: v.optional(v.id("messages")),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId)
    if (!run) throw new Error("Run not found")
    await requireChatOwner(ctx, run.chatId)
    const now = nowMs()
    await ctx.db.patch(args.runId, {
      status: "failed",
      error: args.error,
      completedAt: now,
      updatedAt: now,
      activeStreamId: undefined,
    })
    const messageId = args.messageId ?? run.assistantMessageId
    if (messageId) {
      await ctx.db.patch(messageId, {
        status: "failed",
        error: args.error,
        updatedAt: now,
      })
    }
  },
})

export const markGenerationRunAborted = mutation({
  args: {
    runId: v.id("generationRuns"),
    messageId: v.optional(v.id("messages")),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId)
    if (!run) throw new Error("Run not found")
    await requireChatOwner(ctx, run.chatId)
    const now = nowMs()
    await ctx.db.patch(args.runId, {
      status: "aborted",
      error: args.reason,
      completedAt: now,
      updatedAt: now,
      activeStreamId: undefined,
    })
    const messageId = args.messageId ?? run.assistantMessageId
    if (messageId) {
      await ctx.db.patch(messageId, {
        status: "aborted",
        error: args.reason,
        updatedAt: now,
      })
    }
  },
})

export const listMessagesForChatPaginated = query({
  args: {
    chatId: v.id("chats"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const chat = await getAuthorizedChatForRead(ctx, args.chatId)
    if (!chat) return { page: [], isDone: true, continueCursor: "" }

    return await ctx.db
      .query("messages")
      .withIndex("by_chat_order", (q) => q.eq("chatId", args.chatId))
      .paginate(args.paginationOpts)
  },
})

export const listActiveRunsForChat = query({
  args: { chatId: v.id("chats") },
  handler: async (ctx, { chatId }) => {
    const chat = await getAuthorizedChatForRead(ctx, chatId)
    if (!chat) return []
    const activeStatuses = new Set([
      "queued",
      "running",
      "streaming",
      "awaiting_approval",
    ])
    const runs = await ctx.db
      .query("generationRuns")
      .withIndex("by_chat", (q) => q.eq("chatId", chatId))
      .collect()
    return runs
      .filter((run) => activeStatuses.has(run.status))
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

    const messages = await listMessages(ctx, chatId)
    const runs = await ctx.db
      .query("generationRuns")
      .withIndex("by_chat_updated", (q) => q.eq("chatId", chatId))
      .order("desc")
      .take(10)

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
      activeRuns: runs.filter((run) =>
        ["queued", "running", "streaming", "awaiting_approval"].includes(
          run.status
        )
      ),
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
  handler: async (ctx, args) => {
    const { user } = await requireChatOwner(ctx, args.chatId)
    const run = await ctx.db.get(args.runId)
    if (!run || run.chatId !== args.chatId) throw new Error("Run not found")

    const existing = await ctx.db
      .query("toolApprovalRequests")
      .withIndex("by_approval", (q) => q.eq("approvalId", args.approvalId))
      .unique()
    if (existing) return existing._id

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
  },
})

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
  handler: async (ctx, args) => {
    await requireChatOwner(ctx, args.chatId)
    const run = await ctx.db.get(args.runId)
    if (!run || run.chatId !== args.chatId) throw new Error("Run not found")
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
  },
})
