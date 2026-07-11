import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"
import {
  getEffectiveParentId,
  getNextBranchIndex,
  getNextMissingBranchIndex,
  getSelectedPathBranchNormalizationPatches,
  getSelectedPathMessages,
  getSiblingMessages,
  type MessageBranchPatch,
} from "./message_branches"

type ChatMessage = Doc<"messages">

type MessageBranchWriteResult = {
  message: ChatMessage
  created: boolean
  selectedPath: ChatMessage[]
}

type MessageBranchWriterOptions = {
  chatId: Id<"chats">
  now: number
}

type WriteUserMessageInput = {
  clientMessageId: string
  userId: Id<"users">
  content: string
  parts: unknown
  requestId: string
  model: string
  provider: string
  replaces?: Id<"messages">
}

type WriteAssistantPlaceholderInput = {
  generationRunId: Id<"generationRuns">
  requestId: string
  model: string
  provider: string
  replaces?: Id<"messages">
}

const PLANNED_MESSAGE_ID = "__planned_message__" as Id<"messages">

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
  const patches = getSelectedPathBranchNormalizationPatches(messages)

  for (const patch of patches) {
    normalizedMessages = applyPatchToMessages(
      normalizedMessages,
      patch.messageId,
      patchFromNormalization(patch)
    )
  }

  return normalizedMessages
}

function planSiblingSelection(
  messages: ChatMessage[],
  target: ChatMessage
): ChatMessage[] {
  const parentMessageId = getEffectiveParentId(messages, target)
  let updatedMessages = messages
  const siblings = getSiblingMessages(messages, parentMessageId, target.role)

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
      patch.branchIndex = getNextMissingBranchIndex(updatedMessages, sibling)
    }
    updatedMessages = applyPatchToMessages(
      updatedMessages,
      sibling._id,
      patch
    )
  }

  return updatedMessages
}

function planSiblingDeselection(
  messages: ChatMessage[],
  parentMessageId: Id<"messages"> | undefined,
  role: ChatMessage["role"]
): ChatMessage[] {
  let updatedMessages = messages
  const siblings = getSiblingMessages(messages, parentMessageId, role)

  for (const sibling of siblings) {
    const patch: Partial<ChatMessage> = { selected: false }
    if (
      sibling.parentMessageId === undefined &&
      parentMessageId !== undefined
    ) {
      patch.parentMessageId = parentMessageId
    }
    if (sibling.branchIndex === undefined) {
      patch.branchIndex = getNextMissingBranchIndex(updatedMessages, sibling)
    }
    updatedMessages = applyPatchToMessages(
      updatedMessages,
      sibling._id,
      patch
    )
  }

  return updatedMessages
}

function nextMessageOrder(messages: ChatMessage[]) {
  return messages.reduce(
    (next, message) => Math.max(next, message.orderId + 1),
    0
  )
}

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
    !getSelectedPathMessages(messages).some(
      (message) => message._id === messageId
    )
  ) {
    throw new Error("Selected message is not reachable on the Selected path")
  }
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
      throw new Error(`Message branch target must be ${article} ${role} message`)
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

  async function finish(
    messageId: Id<"messages">,
    created: boolean
  ): Promise<MessageBranchWriteResult> {
    const messages = await loadMessages()
    const normalized = planSelectedPathNormalization(messages)
    assertSelectedPathContains(normalized, messageId)
    await applyPlannedBranchChanges(messages, normalized)

    const finalMessages = await loadMessages()
    const message = finalMessages.find((candidate) => candidate._id === messageId)
    if (!message) throw new Error("Selected message not found after branch write")

    return {
      message,
      created,
      selectedPath: getSelectedPathMessages(finalMessages),
    }
  }

  async function select(
    messageId: Id<"messages">
  ): Promise<MessageBranchWriteResult> {
    const target = await ctx.db.get(messageId)
    if (!target || target.chatId !== chatId) {
      throw new Error("Message not found")
    }

    const messages = await loadMessages()
    const normalized = planSelectedPathNormalization(messages)
    const normalizedTarget = normalized.find(
      (message) => message._id === target._id
    )
    if (!normalizedTarget) throw new Error("Message not found")

    const selected = planSelectedPathNormalization(
      planSiblingSelection(normalized, normalizedTarget)
    )
    assertSelectedPathContains(selected, target._id)
    await applyPlannedBranchChanges(messages, selected)
    return await finish(target._id, false)
  }

  async function writeUserMessage(
    input: WriteUserMessageInput
  ): Promise<MessageBranchWriteResult> {
    if (input.replaces) await requireTarget(input.replaces, "user")

    const messages = await loadMessages()
    const existing = messages.find(
      (message) =>
        message.role === "user" &&
        message.clientMessageId === input.clientMessageId
    )
    if (existing) return await select(existing._id)

    const normalized = planSelectedPathNormalization(messages)
    const replacement = input.replaces
      ? normalized.find((message) => message._id === input.replaces)
      : undefined
    if (input.replaces && !replacement) throw new Error("Message not found")

    const selectedPath = getSelectedPathMessages(normalized)
    const parentMessageId = replacement
      ? getEffectiveParentId(normalized, replacement)
      : selectedPath.at(-1)?._id
    const deselected = planSiblingDeselection(
      normalized,
      parentMessageId,
      "user"
    )
    const plannedMessage = {
      _id: PLANNED_MESSAGE_ID,
      _creationTime: now,
      chatId,
      orderId: nextMessageOrder(deselected),
      clientMessageId: input.clientMessageId,
      userId: input.userId,
      role: "user" as const,
      content: input.content,
      parts: input.parts,
      parentMessageId,
      branchIndex: getNextBranchIndex(deselected, parentMessageId, "user"),
      selected: true,
      status: "completed" as const,
      requestId: input.requestId,
      model: input.model,
      provider: input.provider,
      createdAt: now,
      updatedAt: now,
    } satisfies ChatMessage
    const planned = planSelectedPathNormalization([
      ...deselected,
      plannedMessage,
    ])
    assertSelectedPathContains(planned, PLANNED_MESSAGE_ID)

    await applyPlannedBranchChanges(messages, planned)
    const {
      _id: _plannedId,
      _creationTime: _plannedCreationTime,
      ...messageValue
    } = plannedMessage
    const messageId = await ctx.db.insert("messages", messageValue)
    return await finish(messageId, true)
  }

  async function writeAssistantPlaceholder(
    input: WriteAssistantPlaceholderInput
  ): Promise<MessageBranchWriteResult> {
    const replacement = input.replaces
      ? await requireTarget(input.replaces, "assistant")
      : undefined
    const messages = await loadMessages()
    const normalized = planSelectedPathNormalization(messages)
    const normalizedReplacement = replacement
      ? normalized.find((message) => message._id === replacement._id)
      : undefined
    if (replacement && !normalizedReplacement) {
      throw new Error("Message not found")
    }

    const selectedPath = getSelectedPathMessages(normalized)
    const parentMessageId = normalizedReplacement
      ? getEffectiveParentId(normalized, normalizedReplacement)
      : selectedPath.at(-1)?._id
    const deselected = planSiblingDeselection(
      normalized,
      parentMessageId,
      "assistant"
    )
    const plannedMessage = {
      _id: PLANNED_MESSAGE_ID,
      _creationTime: now,
      chatId,
      orderId: nextMessageOrder(deselected),
      role: "assistant" as const,
      content: "",
      parts: [],
      parentMessageId,
      branchIndex: getNextBranchIndex(
        deselected,
        parentMessageId,
        "assistant"
      ),
      selected: true,
      regenerationSourceMessageId: normalizedReplacement?._id,
      status: "streaming" as const,
      requestId: input.requestId,
      generationRunId: input.generationRunId,
      model: input.model,
      provider: input.provider,
      createdAt: now,
      updatedAt: now,
    } satisfies ChatMessage
    const planned = planSelectedPathNormalization([
      ...deselected,
      plannedMessage,
    ])
    assertSelectedPathContains(planned, PLANNED_MESSAGE_ID)

    await applyPlannedBranchChanges(messages, planned)
    const {
      _id: _plannedId,
      _creationTime: _plannedCreationTime,
      ...messageValue
    } = plannedMessage
    const messageId = await ctx.db.insert("messages", messageValue)
    return await finish(messageId, true)
  }

  return {
    writeUserMessage,
    writeAssistantPlaceholder,
    select,
  }
}
