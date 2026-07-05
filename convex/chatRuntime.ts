import { v } from "convex/values"
import type { Doc, Id } from "./_generated/dataModel"
import { mutation, type MutationCtx, type QueryCtx } from "./_generated/server"
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
  isTerminalGenerationRunStatus,
  isTerminalMessageStatus,
} from "./domain/message_contract"
import { extractTextFromMessageParts } from "./domain/message_parts"
import {
  hasSemanticAssistantParts,
  isTerminalOutcomeStub,
  isVisibleChatMessage,
  projectModelHistoryMessages,
} from "./domain/message_visibility"
import { getCurrentUser, requireOwnedChat } from "./lib/auth"
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

// The run-scoped owner check delegates to the shared requireOwnedChat so there
// is a single owned-chat implementation. Most call sites here pass a chat id
// derived from a fetched generation run (run.chatId), which is why this is a
// helper rather than an ownedChatMutation builder.
async function requireChatOwner(
  ctx: QueryCtx | MutationCtx,
  chatId: Id<"chats">
): Promise<AuthenticatedOwner> {
  return await requireOwnedChat(ctx, chatId)
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
  const parentMessageId = getEffectiveParentId(messages, message)
  const semanticSiblings = getSiblingMessages(
    messages,
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
  const resolvedMessageId =
    messageId ??
    run.assistantMessageId ??
    (run.activeStreamId as Id<"messages"> | undefined)
  if (!resolvedMessageId) return null

  const message = await ctx.db.get(resolvedMessageId)
  if (
    !message ||
    message.chatId !== run.chatId ||
    message.role !== "assistant"
  ) {
    return null
  }

  const isReusedForRegeneration =
    typeof run.startedAt === "number" && message.createdAt < run.startedAt
  // Only meaningful for a reused regeneration, and only worth the read there.
  const hasSnapshotForRun = isReusedForRegeneration
    ? (await ctx.db
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
          await selectMessageSiblingForMutation(ctx, messages, sibling, now)
        }
      }
      await ctx.db.delete(message._id)
      return undefined
    }
  }
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
    assistantMessageId,
  })

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

// The selected path token is validated by the caller BEFORE the supersede
// sweep runs (prepareGenerationForChat) — the token describes the client's
// rendered view, and the sweep may legitimately materialize a terminal stub
// the client could not have counted yet. Re-validating here after the sweep
// falsely rejected the first send following a reaped zombie run.
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
  now: number
) {
  let currentMessages = await normalizeSelectedBranchPathForMutation(
    ctx,
    await listMessages(ctx, args.chatId),
    now
  )
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
    regenerationSourceMessageId: targetMessage._id,
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
    messages: projectModelHistoryMessages(
      selectedMessages.slice(0, pairedUserIndex + 1)
    ),
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
        })
      }
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
    await ctx.db.patch(runId, {
      status: verdict.run.status,
      completedAt: verdict.run.settle ? now : undefined,
      updatedAt: now,
      activeStreamId: undefined,
    })
  }

  return updatedMessage
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
    projectModelHistoryMessages(
      getSelectedPathMessages(await listMessages(ctx, args.chatId)).filter(
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
  },
  handler: async (ctx, args) => prepareGenerationForChat(ctx, args),
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
  handler: async (ctx, args) => updateAssistantSnapshotForChat(ctx, args),
})

export async function updateAssistantSnapshotForChat(
  ctx: MutationCtx,
  args: {
    runId: Id<"generationRuns">
    chatId: Id<"chats">
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
  await requireChatOwner(ctx, args.chatId)
  const run = await ctx.db.get(args.runId)
  if (!run || run.chatId !== args.chatId) throw new Error("Run not found")
  const message = await requireAssistantMessageForRun(ctx, run, args.messageId)

  // A terminal run accepts no further snapshots. A streamer that lost the
  // abort/supersede race must become read-only here — its continued writes
  // to the run and message docs are what OCC-starve the next turn's
  // prepareGeneration on the same chat.
  if (isTerminalGenerationRunStatus(run.status)) return

  const now = nowMs()
  const snapshotId = await ctx.db.insert("assistantMessageSnapshots", {
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

  const latestSnapshot = await ctx.db
    .query("assistantMessageSnapshots")
    .withIndex("by_run_sequence", (q) => q.eq("runId", args.runId))
    .order("desc")
    .first()
  if (latestSnapshot?._id !== snapshotId) return

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
}

export const markGenerationRunCompleted = mutation({
  args: {
    runId: v.id("generationRuns"),
    messageId: v.id("messages"),
    content: v.string(),
    parts: v.any(),
    metadata: v.optional(vToolInvocationStreamMetadata),
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
  const run = await ctx.db.get(args.runId)
  if (!run) throw new Error("Run not found")
  await requireChatOwner(ctx, run.chatId)
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
        q.eq("runId", args.runId).eq("status", "pending")
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
  await ctx.db.patch(args.runId, {
    status: verdict.run.status,
    completedAt: verdict.run.settle ? now : undefined,
    updatedAt: now,
    finishReason: args.finishReason,
    inputTokens: args.usage?.inputTokens,
    outputTokens: args.usage?.outputTokens,
    totalToolCalls: args.totalToolCalls,
    failedToolCalls: args.failedToolCalls,
    activeStreamId: undefined,
  })
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
): Promise<Id<"toolApprovalRequests"> | null> {
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
    status: verdict.run.status,
    updatedAt: now,
  })
  await ctx.db.patch(args.assistantMessageId, {
    status: verdict.message.status,
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
