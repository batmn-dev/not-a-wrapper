import type { Doc, Id } from "../_generated/dataModel"

type ChatMessage = Doc<"messages">

const ROOT_PARENT_KEY = "__root__"

type MessageBranchSibling = {
  messageId: Id<"messages">
  clientMessageId?: string
}

export type MessageBranchInfo = {
  messageId: Id<"messages">
  currentIndex: number
  total: number
  siblings: MessageBranchSibling[]
}

/**
 * The canonical branch context: one immutable snapshot of sorting, legacy
 * effective parents, child grouping, and lookup maps per message-array
 * version. All branch semantics live in
 * `createBranchContext` and the `*FromContext` primitives; the array-based
 * exports below are one-line adapters kept as migration aids — they are NOT
 * an alternate implementation.
 *
 * A context is valid only for the exact array it was built from. Never reuse
 * one after any message's branch field (parentMessageId / branchIndex /
 * selected) changes — build a new context for the new array version.
 */
export type BranchContext = Readonly<{
  sortedMessages: readonly ChatMessage[]
  effectiveParentById: ReadonlyMap<Id<"messages">, Id<"messages"> | undefined>
  /** Branch-sorted children per effective parent, roles mixed — the selected-path traversal order. */
  childrenByParent: ReadonlyMap<string, readonly ChatMessage[]>
  /** Branch-sorted children per effective parent AND role — sibling-group order. */
  childrenByParentAndRole: ReadonlyMap<string, readonly ChatMessage[]>
  hasBranchState: boolean
}>

function sortMessages(messages: readonly ChatMessage[]) {
  return [...messages].sort((a, b) => {
    if (a.orderId !== b.orderId) return a.orderId - b.orderId
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
    return String(a._id).localeCompare(String(b._id))
  })
}

function parentKey(parentId: Id<"messages"> | undefined) {
  return parentId ?? ROOT_PARENT_KEY
}

// Separator for composite parent+role map keys. U+0000 cannot appear in
// Convex ids, roles, or the __root__ sentinel, so the composite key is
// collision-free. Kept as an escape (never a literal byte) so this file
// stays text for git/grep — do not inline a raw NUL character.
const PARENT_ROLE_KEY_SEPARATOR = "\u0000"

function parentRoleKey(
  parentId: Id<"messages"> | undefined,
  role: ChatMessage["role"]
) {
  return `${parentKey(parentId)}${PARENT_ROLE_KEY_SEPARATOR}${role}`
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

/**
 * The only place that sorts messages, computes legacy effective parents,
 * groups and orders children, and builds lookup maps. Effective-parent
 * inference is deliberately order-dependent (a row without explicit branch
 * state chains to the previous row in sort order unless it is an explicit
 * root sibling seen after another root row of its role) — preserved exactly
 * from the pre-context implementation.
 */
export function createBranchContext(
  messages: readonly ChatMessage[]
): BranchContext {
  const sortedMessages = sortMessages(messages)
  const effectiveParentById = new Map<
    Id<"messages">,
    Id<"messages"> | undefined
  >()
  const childrenByParent = new Map<string, ChatMessage[]>()
  let previousLinearMessageId: Id<"messages"> | undefined
  let anyExplicitBranchState = false

  for (const message of sortedMessages) {
    const explicit = hasExplicitBranchState(message)
    if (explicit) anyExplicitBranchState = true
    let effectiveParentId = message.parentMessageId

    if (effectiveParentId === undefined && previousLinearMessageId) {
      const isExplicitRootSibling =
        explicit && hasRootSiblingWithRole(childrenByParent, message.role)
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

  const childrenByParentAndRole = new Map<string, ChatMessage[]>()
  for (const [key, siblings] of childrenByParent) {
    const sorted = branchSort(siblings)
    childrenByParent.set(key, sorted)
    for (const message of sorted) {
      const roleKey = `${key}${PARENT_ROLE_KEY_SEPARATOR}${message.role}`
      const group = childrenByParentAndRole.get(roleKey) ?? []
      group.push(message)
      childrenByParentAndRole.set(roleKey, group)
    }
  }

  return {
    sortedMessages,
    effectiveParentById,
    childrenByParent,
    childrenByParentAndRole,
    hasBranchState: anyExplicitBranchState,
  }
}

function chooseSelectedMessage(messages: readonly ChatMessage[]) {
  const selectedMessage = messages.find((message) => message.selected === true)
  if (selectedMessage) return selectedMessage

  return messages.find((message) => message.selected !== false)
}

export function getEffectiveParentIdFromContext(
  context: BranchContext,
  message: ChatMessage
) {
  return context.effectiveParentById.get(message._id)
}

export function getSiblingMessagesFromContext(
  context: BranchContext,
  parentId: Id<"messages"> | undefined,
  role: ChatMessage["role"]
): ChatMessage[] {
  return [
    ...(context.childrenByParentAndRole.get(parentRoleKey(parentId, role)) ??
      []),
  ]
}

export function getNextBranchIndexFromContext(
  context: BranchContext,
  parentId: Id<"messages"> | undefined,
  role: ChatMessage["role"]
) {
  const siblings = getSiblingMessagesFromContext(context, parentId, role)
  if (siblings.length === 0) return 0

  const branchIndexes = siblings.map((message, index) => {
    return message.branchIndex ?? index
  })

  return Math.max(...branchIndexes) + 1
}

export function getSelectedPathMessagesFromContext(
  context: BranchContext
): ChatMessage[] {
  if (!context.hasBranchState) return [...context.sortedMessages]

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

/**
 * Missing-branch-index assignments for one sibling group, computed in a
 * single pass over the group in message-sort order. The
 * assignment matches the pre-context sequential behavior exactly: every call
 * for the same group walked the same order and produced the same indexes, so
 * one pass per group is a pure de-duplication. Memoized per context — a new
 * array version gets a new context and fresh assignments.
 */
type MissingIndexAssignment = {
  assignments: Map<Id<"messages">, number>
  fallthroughIndex: number
}

const missingIndexMemo = new WeakMap<
  BranchContext,
  Map<string, MissingIndexAssignment>
>()

function getMissingIndexAssignment(
  context: BranchContext,
  parentId: Id<"messages"> | undefined,
  role: ChatMessage["role"]
): MissingIndexAssignment {
  let byGroup = missingIndexMemo.get(context)
  if (!byGroup) {
    byGroup = new Map()
    missingIndexMemo.set(context, byGroup)
  }
  const groupKey = parentRoleKey(parentId, role)
  const cached = byGroup.get(groupKey)
  if (cached) return cached

  // Assignment walks the group in message-sort order (NOT branch order) —
  // the pre-context implementation re-sorted siblings with `sortMessages`
  // before assigning, and that order is load-bearing for exact equivalence.
  const siblings = sortMessages(
    getSiblingMessagesFromContext(context, parentId, role)
  )
  const used = new Set(
    siblings
      .map((sibling) => sibling.branchIndex)
      .filter((index): index is number => typeof index === "number")
  )
  const assignments = new Map<Id<"messages">, number>()
  let nextIndex = 0

  for (const sibling of siblings) {
    if (sibling.branchIndex !== undefined) continue
    while (used.has(nextIndex)) nextIndex += 1
    assignments.set(sibling._id, nextIndex)
    used.add(nextIndex)
    nextIndex += 1
  }

  const assignment: MissingIndexAssignment = {
    assignments,
    fallthroughIndex: nextIndex,
  }
  byGroup.set(groupKey, assignment)
  return assignment
}

export function getNextMissingBranchIndexFromContext(
  context: BranchContext,
  target: ChatMessage
) {
  const parentId = getEffectiveParentIdFromContext(context, target)
  const assignment = getMissingIndexAssignment(context, parentId, target.role)
  return assignment.assignments.get(target._id) ?? assignment.fallthroughIndex
}

export function getSelectedPathBranchNormalizationPatchesFromContext(
  context: BranchContext,
  options: {
    skipSelectedMessageIds?: Set<Id<"messages">>
  } = {}
): MessageBranchPatch[] {
  const selectedPath = getSelectedPathMessagesFromContext(context)
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
      patch.branchIndex = getNextMissingBranchIndexFromContext(context, message)
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

export function getBranchInfoForMessageFromContext(
  context: BranchContext,
  message: ChatMessage
): MessageBranchInfo | undefined {
  const parentId = getEffectiveParentIdFromContext(context, message)
  const siblings = getSiblingMessagesFromContext(context, parentId, message.role)
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

// Test/benchmark-only array adapters — one-line delegations to the context
// primitives above. Each builds a throwaway context; production hot paths use
// the shared `*FromContext` primitives instead.
export function getEffectiveParentId(
  messages: ChatMessage[],
  message: ChatMessage
) {
  return getEffectiveParentIdFromContext(createBranchContext(messages), message)
}

export function getSiblingMessages(
  messages: ChatMessage[],
  parentId: Id<"messages"> | undefined,
  role: ChatMessage["role"]
) {
  return getSiblingMessagesFromContext(
    createBranchContext(messages),
    parentId,
    role
  )
}

export function getNextBranchIndex(
  messages: ChatMessage[],
  parentId: Id<"messages"> | undefined,
  role: ChatMessage["role"]
) {
  return getNextBranchIndexFromContext(
    createBranchContext(messages),
    parentId,
    role
  )
}

export function getSelectedPathMessages(messages: ChatMessage[]) {
  return getSelectedPathMessagesFromContext(createBranchContext(messages))
}

export function getNextMissingBranchIndex(
  messages: ChatMessage[],
  target: ChatMessage
) {
  return getNextMissingBranchIndexFromContext(
    createBranchContext(messages),
    target
  )
}

export function getSelectedPathBranchNormalizationPatches(
  messages: ChatMessage[],
  options: {
    skipSelectedMessageIds?: Set<Id<"messages">>
  } = {}
): MessageBranchPatch[] {
  return getSelectedPathBranchNormalizationPatchesFromContext(
    createBranchContext(messages),
    options
  )
}

export function getBranchInfoForMessage(
  messages: ChatMessage[],
  message: ChatMessage
): MessageBranchInfo | undefined {
  return getBranchInfoForMessageFromContext(
    createBranchContext(messages),
    message
  )
}
