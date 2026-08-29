import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"
import {
  createBranchContext,
  getEffectiveParentIdFromContext,
  getNextBranchIndexFromContext,
  getNextMissingBranchIndexFromContext,
  getSelectedPathBranchNormalizationPatchesFromContext,
  getSelectedPathMessagesFromContext,
  getSiblingMessagesFromContext,
  type BranchContext,
  type MessageBranchPatch,
} from "./message_branches"

type ChatMessage = Doc<"messages">

/**
 * A branch write's new-message payload before insertion — the stored shape
 * minus the system columns Convex assigns at insert.
 */
type PlannedMessage = Omit<ChatMessage, "_id" | "_creationTime">

/**
 * The request/model/provider stamp a branch write carries onto its new
 * message — which Generation run's request produced it.
 */
type WriteProvenance = {
  requestId: string
  model: string
  provider: string
}

type MessageBranchWriterOptions = {
  chatId: Id<"chats">
  now: number
}

type PlanUserMessageOptions = MessageBranchWriterOptions & {
  input: WriteUserMessageInput
}

/** The explicit absence of a provenance stamp — all three fields or none. */
type NoWriteProvenance = {
  requestId?: undefined
  model?: undefined
  provider?: undefined
}

/**
 * User-message provenance is optional AS A GROUP because the atomic first-turn
 * creation writes the user message BEFORE any generation request exists. The
 * run that later claims the row (prepareGeneration's idempotent write, same
 * clientMessageId) adopts its stamp onto the un-stamped row, so durable user
 * messages still converge on generation provenance. The union makes a
 * half-stamp (a requestId without its model/provider) unrepresentable — a
 * requestId permanently blocks later adoption, so it must never land without
 * the full stamp. Assistant placeholders are only ever written by a
 * generation, so their stamp stays required.
 */
type WriteUserMessageInput = (WriteProvenance | NoWriteProvenance) & {
  clientMessageId: string
  userId: Id<"users">
  content: string
  /**
   * Opaque pass-through by contract: the writer never inspects parts, and the
   * storage column is `v.any()` — `unknown` here is deliberately stricter
   * than the schema, not a missing type.
   */
  parts: unknown
  replaces?: Id<"messages">
}

type WriteAssistantPlaceholderInput = WriteProvenance & {
  generationRunId: Id<"generationRuns">
  replaces?: Id<"messages">
}

/**
 * The one place a planned (not-yet-inserted) message enters the stored-shape
 * planning pipeline. The planning helpers (message_branches.ts) are typed
 * over stored docs, so the planned entry is simulated under a reserved id
 * that can never collide with a real Convex id. The simulation never leaks:
 * `applyPlannedBranchChanges` iterates only stored docs, so the simulated
 * entry is never patched — its values reach the database through
 * `db.insert(plannedMessage)` instead.
 */
const PLANNED_MESSAGE_ID = "__planned_message__" as Id<"messages">

function asSimulatedDoc(
  planned: PlannedMessage,
  creationTime: number
): ChatMessage {
  return { _id: PLANNED_MESSAGE_ID, _creationTime: creationTime, ...planned }
}

/**
 * One `BranchContext` per immutable message-array version. Every plan step
 * that changes a branch field produces a NEW array (`applyPatchToMessages`
 * maps to a fresh array), so keying the cache by array reference is exactly
 * the plan's lifecycle rule: a context is never reused after any branch field
 * in its source array changes, and each logical array version is built once.
 */
const contextByArrayVersion = new WeakMap<
  readonly ChatMessage[],
  BranchContext
>()

function contextFor(messages: ChatMessage[]): BranchContext {
  let context = contextByArrayVersion.get(messages)
  if (!context) {
    context = createBranchContext(messages)
    contextByArrayVersion.set(messages, context)
  }
  return context
}

function applyPatchToMessages(
  messages: ChatMessage[],
  messageId: Id<"messages">,
  patch: Partial<ChatMessage>
): ChatMessage[] {
  return messages.map((message) =>
    message._id === messageId ? { ...message, ...patch } : message
  )
}

function patchFromNormalization(
  patch: MessageBranchPatch
): Partial<ChatMessage> {
  const next: Partial<ChatMessage> = {}
  if (patch.parentMessageId !== undefined) {
    next.parentMessageId = patch.parentMessageId
  }
  if (patch.branchIndex !== undefined) {
    next.branchIndex = patch.branchIndex
  }
  if (patch.selected !== undefined) {
    next.selected = patch.selected
  }
  return next
}

function planSelectedPathNormalization(messages: ChatMessage[]) {
  let normalizedMessages = messages
  const patches = getSelectedPathBranchNormalizationPatchesFromContext(
    contextFor(messages)
  )

  for (const patch of patches) {
    normalizedMessages = applyPatchToMessages(
      normalizedMessages,
      patch.messageId,
      patchFromNormalization(patch)
    )
  }

  return normalizedMessages
}

/**
 * Sibling patches are planned from one context of the entry array: missing
 * branch indexes for the whole group are assigned in one pass, in stable
 * message order, without rebuilding after each sibling patch.
 */
function planSiblingSelection(
  messages: ChatMessage[],
  target: ChatMessage
): ChatMessage[] {
  const context = contextFor(messages)
  const parentMessageId = getEffectiveParentIdFromContext(context, target)
  let updatedMessages = messages
  const siblings = getSiblingMessagesFromContext(
    context,
    parentMessageId,
    target.role
  )

  for (const sibling of siblings) {
    const patch: Partial<ChatMessage> = {
      selected: sibling._id === target._id,
    }
    if (
      sibling.parentMessageId === undefined &&
      parentMessageId !== undefined
    ) {
      patch.parentMessageId = parentMessageId
    }
    if (sibling.branchIndex === undefined) {
      patch.branchIndex = getNextMissingBranchIndexFromContext(context, sibling)
    }
    updatedMessages = applyPatchToMessages(updatedMessages, sibling._id, patch)
  }

  return updatedMessages
}

function planSiblingDeselection(
  messages: ChatMessage[],
  parentMessageId: Id<"messages"> | undefined,
  role: ChatMessage["role"]
): ChatMessage[] {
  const context = contextFor(messages)
  let updatedMessages = messages
  const siblings = getSiblingMessagesFromContext(context, parentMessageId, role)

  for (const sibling of siblings) {
    const patch: Partial<ChatMessage> = { selected: false }
    if (
      sibling.parentMessageId === undefined &&
      parentMessageId !== undefined
    ) {
      patch.parentMessageId = parentMessageId
    }
    if (sibling.branchIndex === undefined) {
      patch.branchIndex = getNextMissingBranchIndexFromContext(context, sibling)
    }
    updatedMessages = applyPatchToMessages(updatedMessages, sibling._id, patch)
  }

  return updatedMessages
}

function nextMessageOrder(messages: ChatMessage[]) {
  return messages.reduce(
    (next, message) => Math.max(next, message.orderId + 1),
    0
  )
}

/**
 * Diff one message's planned branch fields against its stored state.
 * Unchanged siblings return null and are not patched — so their `updatedAt`
 * is deliberately NOT bumped: "touched" means a branch field actually
 * changed, not "was considered by a plan".
 */
function branchPatch(
  before: ChatMessage,
  after: ChatMessage,
  now: number
): Partial<ChatMessage> | null {
  const patch: Partial<ChatMessage> = {}

  if (before.parentMessageId !== after.parentMessageId) {
    patch.parentMessageId = after.parentMessageId
  }
  if (before.branchIndex !== after.branchIndex) {
    patch.branchIndex = after.branchIndex
  }
  if (before.selected !== after.selected) {
    patch.selected = after.selected
  }

  if (Object.keys(patch).length === 0) return null
  patch.updatedAt = now
  return patch
}

function assertSelectedPathContains(
  messages: ChatMessage[],
  messageId: Id<"messages">
) {
  if (
    !getSelectedPathMessagesFromContext(contextFor(messages)).some(
      (message) => message._id === messageId
    )
  ) {
    throw new Error("Selected message is not reachable on the Selected path")
  }
}

type PlannedSelection = {
  messages: ChatMessage[]
  target: ChatMessage
}

function planMessageSelection(
  messages: ChatMessage[],
  messageId: Id<"messages">
): PlannedSelection {
  const normalized = planSelectedPathNormalization(messages)
  const target = normalized.find((message) => message._id === messageId)
  if (!target) throw new Error("Message not found")

  const selected = planSelectedPathNormalization(
    planSiblingSelection(normalized, target)
  )
  assertSelectedPathContains(selected, target._id)
  return { messages: selected, target }
}

type PlannedBranchInsertion = {
  messages: ChatMessage[]
  message: ChatMessage
  plannedMessage: PlannedMessage
}

function planBranchInsertion(
  messages: ChatMessage[],
  options: MessageBranchWriterOptions,
  role: "user" | "assistant",
  replaces: Id<"messages"> | undefined,
  buildPlanned: (facts: {
    parentMessageId: Id<"messages"> | undefined
    orderId: number
    branchIndex: number
    replacement: ChatMessage | undefined
  }) => PlannedMessage
): PlannedBranchInsertion {
  const normalized = planSelectedPathNormalization(messages)
  const replacement = replaces
    ? normalized.find((message) => message._id === replaces)
    : undefined
  if (replaces && !replacement) throw new Error("Message not found")

  const normalizedContext = contextFor(normalized)
  const selectedPath = getSelectedPathMessagesFromContext(normalizedContext)
  const parentMessageId = replacement
    ? getEffectiveParentIdFromContext(normalizedContext, replacement)
    : selectedPath.at(-1)?._id
  const deselected = planSiblingDeselection(normalized, parentMessageId, role)
  const plannedMessage = buildPlanned({
    parentMessageId,
    orderId: nextMessageOrder(deselected),
    branchIndex: getNextBranchIndexFromContext(
      contextFor(deselected),
      parentMessageId,
      role
    ),
    replacement,
  })
  const message = asSimulatedDoc(plannedMessage, options.now)
  const planned = planSelectedPathNormalization([...deselected, message])
  assertSelectedPathContains(planned, PLANNED_MESSAGE_ID)

  return { messages: planned, message, plannedMessage }
}

function planUserMessageWrite(
  messages: ChatMessage[],
  { chatId, now, input }: PlanUserMessageOptions
):
  | { kind: "existing"; messages: ChatMessage[]; message: ChatMessage }
  | {
      kind: "insert"
      messages: ChatMessage[]
      message: ChatMessage
      plannedMessage: PlannedMessage
    } {
  const existing = messages.find(
    (message) =>
      message.role === "user" &&
      message.clientMessageId === input.clientMessageId
  )
  if (existing) {
    const selected = planMessageSelection(messages, existing._id)
    return { kind: "existing", ...selected, message: selected.target }
  }

  return {
    kind: "insert",
    ...planBranchInsertion(
      messages,
      { chatId, now },
      "user",
      input.replaces,
      (facts) => ({
        chatId,
        orderId: facts.orderId,
        clientMessageId: input.clientMessageId,
        userId: input.userId,
        role: "user" as const,
        content: input.content,
        parts: input.parts,
        parentMessageId: facts.parentMessageId,
        branchIndex: facts.branchIndex,
        selected: true,
        status: "completed" as const,
        requestId: input.requestId,
        model: input.model,
        provider: input.provider,
        createdAt: now,
        updatedAt: now,
      })
    ),
  }
}

/**
 * Read-only counterpart of `writeUserMessage`: the canonical Selected path
 * after the exact branch plan the mutation will apply. Admission preflight
 * uses this so edit/new-message estimation and durable persistence cannot
 * grow separate branch semantics.
 */
export function planSelectedPathAfterUserMessage(
  messages: ChatMessage[],
  options: PlanUserMessageOptions
): ChatMessage[] {
  const planned = planUserMessageWrite(messages, options)
  return getSelectedPathMessagesFromContext(contextFor(planned.messages))
}

export function createMessageBranchWriter(
  ctx: MutationCtx,
  { chatId, now }: MessageBranchWriterOptions
) {
  async function loadMessages() {
    return await ctx.db
      .query("messages")
      .withIndex("by_chat_order", (query) => query.eq("chatId", chatId))
      .collect()
  }

  async function requireTarget(
    messageId: Id<"messages">,
    role: "user" | "assistant"
  ) {
    const message = await ctx.db.get(messageId)
    if (!message || message.chatId !== chatId) {
      throw new Error("Message not found")
    }
    if (message.role !== role) {
      const article = role === "assistant" ? "an" : "a"
      throw new Error(
        `Message branch target must be ${article} ${role} message`
      )
    }
    return message
  }

  async function applyPlannedBranchChanges(
    before: ChatMessage[],
    after: ChatMessage[]
  ) {
    const afterById = new Map(after.map((message) => [message._id, message]))
    for (const message of before) {
      const planned = afterById.get(message._id)
      if (!planned) continue
      const patch = branchPatch(message, planned, now)
      if (patch) await ctx.db.patch(message._id, patch)
    }
  }

  /**
   * Post-write validate-and-repair pass: reload, re-normalize, assert the
   * target is reachable on the Selected path, and apply any repair patches.
   * The second pass is deliberate (CONTEXT.md: post-write validation), not
   * accidental rework — it proves the write left the chat in a legal state.
   */
  async function finish(messageId: Id<"messages">): Promise<ChatMessage> {
    const messages = await loadMessages()
    const normalized = planSelectedPathNormalization(messages)
    assertSelectedPathContains(normalized, messageId)
    await applyPlannedBranchChanges(messages, normalized)

    const message = await ctx.db.get(messageId)
    if (!message)
      throw new Error("Selected message not found after branch write")
    return message
  }

  async function select(messageId: Id<"messages">): Promise<ChatMessage> {
    const target = await ctx.db.get(messageId)
    if (!target || target.chatId !== chatId) {
      throw new Error("Message not found")
    }

    const messages = await loadMessages()
    const selected = planMessageSelection(messages, target._id)
    await applyPlannedBranchChanges(messages, selected.messages)
    return await finish(target._id)
  }

  /**
   * The shared branch-insert spine — the ordering invariant this module
   * exists to own, stated once: load → normalize → resolve replacement →
   * derive parent → deselect siblings → build the planned doc → normalize
   * with the simulated entry → assert Selected-path reachability → apply
   * branch patches → insert → validate-and-repair.
   */
  async function insertPlannedBranch(
    role: "user" | "assistant",
    replaces: Id<"messages"> | undefined,
    buildPlanned: (facts: {
      parentMessageId: Id<"messages"> | undefined
      orderId: number
      branchIndex: number
      replacement: ChatMessage | undefined
    }) => PlannedMessage
  ): Promise<ChatMessage> {
    const messages = await loadMessages()
    const planned = planBranchInsertion(
      messages,
      { chatId, now },
      role,
      replaces,
      buildPlanned
    )
    await applyPlannedBranchChanges(messages, planned.messages)
    const messageId = await ctx.db.insert("messages", planned.plannedMessage)
    return await finish(messageId)
  }

  async function writeUserMessage(
    input: WriteUserMessageInput
  ): Promise<ChatMessage> {
    if (input.replaces) await requireTarget(input.replaces, "user")

    const messages = await loadMessages()
    const planned = planUserMessageWrite(messages, { chatId, now, input })
    if (planned.kind === "existing") {
      // The generation claiming a first-turn row (written pre-request, so
      // un-stamped) adopts its provenance here; an already-stamped row keeps
      // its original stamp.
      if (
        planned.message.requestId === undefined &&
        input.requestId !== undefined
      ) {
        await ctx.db.patch(planned.message._id, {
          requestId: input.requestId,
          model: input.model,
          provider: input.provider,
          updatedAt: now,
        })
      }
      await applyPlannedBranchChanges(messages, planned.messages)
      return await finish(planned.message._id)
    }

    await applyPlannedBranchChanges(messages, planned.messages)
    const messageId = await ctx.db.insert("messages", planned.plannedMessage)
    return await finish(messageId)
  }

  async function writeAssistantPlaceholder(
    input: WriteAssistantPlaceholderInput
  ): Promise<ChatMessage> {
    if (input.replaces) await requireTarget(input.replaces, "assistant")

    return await insertPlannedBranch("assistant", input.replaces, (facts) => ({
      chatId,
      orderId: facts.orderId,
      role: "assistant" as const,
      content: "",
      parts: [],
      parentMessageId: facts.parentMessageId,
      branchIndex: facts.branchIndex,
      selected: true,
      regenerationSourceMessageId: facts.replacement?._id,
      status: "streaming" as const,
      requestId: input.requestId,
      generationRunId: input.generationRunId,
      model: input.model,
      provider: input.provider,
      createdAt: now,
      updatedAt: now,
    }))
  }

  return {
    writeUserMessage,
    writeAssistantPlaceholder,
    select,
  }
}
