/**
 * Test-only legacy fixture: the accepted-behavior baseline for branch-context
 * property and equivalence tests. Never imported by production code. Remove
 * once permanent fixtures fully encode its behavior.
 */
import type { Doc, Id } from "../_generated/dataModel"

type ChatMessage = Doc<"messages">

const ROOT_PARENT_KEY = "__root__"

export type MessageBranchSibling = {
  messageId: Id<"messages">
  clientMessageId?: string
}

export type MessageBranchInfo = {
  messageId: Id<"messages">
  currentIndex: number
  total: number
  siblings: MessageBranchSibling[]
}

type BranchContext = {
  sortedMessages: ChatMessage[]
  effectiveParentById: Map<Id<"messages">, Id<"messages"> | undefined>
  childrenByParent: Map<string, ChatMessage[]>
}

function sortMessages(messages: ChatMessage[]) {
  return [...messages].sort((a, b) => {
    if (a.orderId !== b.orderId) return a.orderId - b.orderId
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
    return String(a._id).localeCompare(String(b._id))
  })
}

function parentKey(parentId: Id<"messages"> | undefined) {
  return parentId ?? ROOT_PARENT_KEY
}

function hasExplicitBranchState(message: ChatMessage) {
  return (
    message.parentMessageId !== undefined ||
    message.branchIndex !== undefined ||
    message.selected !== undefined
  )
}

export function hasBranchState(messages: ChatMessage[]) {
  return messages.some(hasExplicitBranchState)
}

function branchSort(messages: ChatMessage[]) {
  return [...messages].sort((a, b) => {
    const branchIndexA = a.branchIndex ?? Number.MAX_SAFE_INTEGER
    const branchIndexB = b.branchIndex ?? Number.MAX_SAFE_INTEGER
    if (branchIndexA !== branchIndexB) return branchIndexA - branchIndexB
    if (a.orderId !== b.orderId) return a.orderId - b.orderId
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
    return String(a._id).localeCompare(String(b._id))
  })
}

function hasRootSiblingWithRole(
  childrenByParent: Map<string, ChatMessage[]>,
  role: ChatMessage["role"]
) {
  return (childrenByParent.get(ROOT_PARENT_KEY) ?? []).some(
    (message) => message.role === role
  )
}

function buildBranchContext(messages: ChatMessage[]): BranchContext {
  const sortedMessages = sortMessages(messages)
  const effectiveParentById = new Map<
    Id<"messages">,
    Id<"messages"> | undefined
  >()
  const childrenByParent = new Map<string, ChatMessage[]>()
  let previousLinearMessageId: Id<"messages"> | undefined

  for (const message of sortedMessages) {
    let effectiveParentId = message.parentMessageId

    if (effectiveParentId === undefined && previousLinearMessageId) {
      const isExplicitRootSibling =
        hasExplicitBranchState(message) &&
        hasRootSiblingWithRole(childrenByParent, message.role)
      if (!isExplicitRootSibling) {
        effectiveParentId = previousLinearMessageId
      }
    }
    previousLinearMessageId = message._id

    effectiveParentById.set(message._id, effectiveParentId)

    const key = parentKey(effectiveParentId)
    const siblings = childrenByParent.get(key) ?? []
    siblings.push(message)
    childrenByParent.set(key, siblings)
  }

  for (const [key, siblings] of childrenByParent) {
    childrenByParent.set(key, branchSort(siblings))
  }

  return { sortedMessages, effectiveParentById, childrenByParent }
}

function chooseSelectedMessage(messages: ChatMessage[]) {
  const selectedMessage = messages.find((message) => message.selected === true)
  if (selectedMessage) return selectedMessage

  return messages.find((message) => message.selected !== false)
}

export function getEffectiveParentId(
  messages: ChatMessage[],
  message: ChatMessage
) {
  return buildBranchContext(messages).effectiveParentById.get(message._id)
}

export function getSiblingMessages(
  messages: ChatMessage[],
  parentId: Id<"messages"> | undefined,
  role: ChatMessage["role"]
) {
  const context = buildBranchContext(messages)
  return branchSort(
    (context.childrenByParent.get(parentKey(parentId)) ?? []).filter(
      (message) => message.role === role
    )
  )
}

export function getNextBranchIndex(
  messages: ChatMessage[],
  parentId: Id<"messages"> | undefined,
  role: ChatMessage["role"]
) {
  const siblings = getSiblingMessages(messages, parentId, role)
  if (siblings.length === 0) return 0

  const branchIndexes = siblings.map((message, index) => {
    return message.branchIndex ?? index
  })

  return Math.max(...branchIndexes) + 1
}

export function getSelectedPathMessages(messages: ChatMessage[]) {
  const sortedMessages = sortMessages(messages)
  if (!hasBranchState(sortedMessages)) return sortedMessages

  const context = buildBranchContext(sortedMessages)
  const selectedPath: ChatMessage[] = []
  let current = chooseSelectedMessage(
    context.childrenByParent.get(ROOT_PARENT_KEY) ?? []
  )
  const seen = new Set<Id<"messages">>()

  while (current && !seen.has(current._id)) {
    selectedPath.push(current)
    seen.add(current._id)
    current = chooseSelectedMessage(
      context.childrenByParent.get(parentKey(current._id)) ?? []
    )
  }

  return selectedPath
}

export type MessageBranchPatch = {
  messageId: Id<"messages">
  parentMessageId?: Id<"messages">
  branchIndex?: number
  selected?: boolean
}

export function getNextMissingBranchIndex(
  messages: ChatMessage[],
  target: ChatMessage
) {
  const parentId = getEffectiveParentId(messages, target)
  const siblings = sortMessages(
    getSiblingMessages(messages, parentId, target.role)
  )
  const used = new Set(
    siblings
      .map((sibling) => sibling.branchIndex)
      .filter((index): index is number => typeof index === "number")
  )
  let nextIndex = 0

  for (const sibling of siblings) {
    if (sibling.branchIndex !== undefined) continue
    while (used.has(nextIndex)) nextIndex += 1
    if (sibling._id === target._id) return nextIndex
    used.add(nextIndex)
    nextIndex += 1
  }

  return nextIndex
}

export function getSelectedPathBranchNormalizationPatches(
  messages: ChatMessage[],
  options: {
    skipSelectedMessageIds?: Set<Id<"messages">>
  } = {}
): MessageBranchPatch[] {
  const selectedPath = getSelectedPathMessages(messages)
  const patches: MessageBranchPatch[] = []

  for (const [index, message] of selectedPath.entries()) {
    const parentMessageId =
      index === 0 ? undefined : selectedPath[index - 1]?._id
    const patch: MessageBranchPatch = { messageId: message._id }
    let hasPatch = false

    if (
      parentMessageId !== undefined &&
      message.parentMessageId === undefined
    ) {
      patch.parentMessageId = parentMessageId
      hasPatch = true
    }

    if (message.branchIndex === undefined) {
      patch.branchIndex = getNextMissingBranchIndex(messages, message)
      hasPatch = true
    }

    if (
      message.selected === undefined &&
      !options.skipSelectedMessageIds?.has(message._id)
    ) {
      patch.selected = true
      hasPatch = true
    }

    if (hasPatch) patches.push(patch)
  }

  return patches
}

export function getBranchInfoForMessage(
  messages: ChatMessage[],
  message: ChatMessage
): MessageBranchInfo | undefined {
  const parentId = getEffectiveParentId(messages, message)
  const siblings = getSiblingMessages(messages, parentId, message.role)
  if (siblings.length < 2) return undefined

  const currentIndex = siblings.findIndex(
    (sibling) => sibling._id === message._id
  )
  if (currentIndex < 0) return undefined

  return {
    messageId: message._id,
    currentIndex,
    total: siblings.length,
    siblings: siblings.map((sibling) => ({
      messageId: sibling._id,
      clientMessageId: sibling.clientMessageId,
    })),
  }
}
