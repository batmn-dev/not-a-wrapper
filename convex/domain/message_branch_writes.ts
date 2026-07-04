import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"
import {
  getEffectiveParentId,
  getNextBranchIndex,
  getNextMissingBranchIndex,
  getSelectedPathBranchNormalizationPatches,
  getSiblingMessages,
  type MessageBranchPatch,
} from "./message_branches"

type ChatMessage = Doc<"messages">

function applyPatchToMessages(
  messages: ChatMessage[],
  messageId: Id<"messages">,
  patch: Partial<ChatMessage>
): ChatMessage[] {
  return messages.map((message) =>
    message._id === messageId ? { ...message, ...patch } : message
  )
}

async function patchMessageBranch(
  ctx: MutationCtx,
  messages: ChatMessage[],
  messageId: Id<"messages">,
  patch: Partial<ChatMessage>
): Promise<ChatMessage[]> {
  await ctx.db.patch(messageId, patch)
  return applyPatchToMessages(messages, messageId, patch)
}

function patchFromNormalization(
  patch: MessageBranchPatch,
  now: number
): Partial<ChatMessage> {
  const next: Partial<ChatMessage> = { updatedAt: now }
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

export async function normalizeSelectedBranchPathForMutation(
  ctx: MutationCtx,
  messages: ChatMessage[],
  now: number,
  options: {
    skipSelectedMessageIds?: Set<Id<"messages">>
  } = {}
): Promise<ChatMessage[]> {
  let normalizedMessages = messages
  const patches = getSelectedPathBranchNormalizationPatches(
    normalizedMessages,
    options
  )

  for (const patch of patches) {
    normalizedMessages = await patchMessageBranch(
      ctx,
      normalizedMessages,
      patch.messageId,
      patchFromNormalization(patch, now)
    )
  }

  return normalizedMessages
}

export async function clearSiblingSelectionForMutation(
  ctx: MutationCtx,
  messages: ChatMessage[],
  parentMessageId: Id<"messages"> | undefined,
  role: ChatMessage["role"],
  now: number
): Promise<ChatMessage[]> {
  let updatedMessages = messages
  const siblings = getSiblingMessages(messages, parentMessageId, role)
  for (const sibling of siblings) {
    const patch: Partial<ChatMessage> = {
      selected: false,
      updatedAt: now,
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
    updatedMessages = await patchMessageBranch(
      ctx,
      updatedMessages,
      sibling._id,
      patch
    )
  }
  return updatedMessages
}

export async function selectMessageSiblingForMutation(
  ctx: MutationCtx,
  messages: ChatMessage[],
  message: ChatMessage,
  now: number
): Promise<ChatMessage[]> {
  const parentMessageId = getEffectiveParentId(messages, message)
  let updatedMessages = messages
  const siblings = getSiblingMessages(messages, parentMessageId, message.role)
  for (const sibling of siblings) {
    const patch: Partial<ChatMessage> = {
      selected: sibling._id === message._id,
      updatedAt: now,
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
    updatedMessages = await patchMessageBranch(
      ctx,
      updatedMessages,
      sibling._id,
      patch
    )
  }
  return updatedMessages
}

export function getNextBranchIndexForMutation(
  messages: ChatMessage[],
  parentMessageId: Id<"messages"> | undefined,
  role: ChatMessage["role"]
) {
  return getNextBranchIndex(messages, parentMessageId, role)
}
