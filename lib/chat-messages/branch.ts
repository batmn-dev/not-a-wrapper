/**
 * Client-side message-branch model.
 *
 * The backend owns message identity, sibling branches, and selected-path
 * derivation (see `convex/domain/message_branches.ts`). The `getForChat` query
 * returns only the selected linear path, annotating each message with a
 * transient `metadata.branch` descriptor that lists its siblings. The client
 * never receives the full tree, so it renders the server's selected path and
 * uses this descriptor for `< n / m >` navigation.
 *
 * This module defines that descriptor once, as a typed client mirror of
 * `convex/domain/message_branches.ts:MessageBranchInfo`, plus a tolerant parser
 * so branch state is first-class instead of being reached for through
 * `metadata as Record<string, unknown>`.
 */

export type MessageBranchSibling = {
  messageId: string
  clientMessageId?: string
}

export type MessageBranchInfo = {
  messageId: string
  currentIndex: number
  total: number
  siblings: MessageBranchSibling[]
}

/**
 * Typed shape of an `ExtendedUIMessage.metadata` object. The index signature
 * keeps it tolerant of the many other transient fields the durable adapter and
 * the AI SDK attach, while giving first-class access to the fields the renderer
 * relies on.
 */
export type ChatMessageMetadata = {
  serverMessageId?: string
  branch?: MessageBranchInfo
  durableStatus?: unknown
  [key: string]: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isFiniteIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function parseSibling(value: unknown): MessageBranchSibling | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.messageId !== "string" || value.messageId.length === 0) {
    return undefined
  }
  return {
    messageId: value.messageId,
    ...(typeof value.clientMessageId === "string"
      ? { clientMessageId: value.clientMessageId }
      : {}),
  }
}

/**
 * Validate and normalize an unknown value into a {@link MessageBranchInfo}.
 *
 * Tolerant by design: it does not require `siblings.length === total` (a partial
 * sibling list during an optimistic/streaming frame is acceptable), only that
 * the shape is coherent and `currentIndex` is in range. Returns `undefined` for
 * anything that isn't a usable branch descriptor.
 */
export function parseMessageBranchInfo(
  value: unknown
): MessageBranchInfo | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.messageId !== "string" || value.messageId.length === 0) {
    return undefined
  }
  if (!isFiniteIndex(value.currentIndex)) return undefined
  if (!isFiniteIndex(value.total) || value.total < 1) return undefined
  if (!Array.isArray(value.siblings)) return undefined

  const siblings = value.siblings
    .map(parseSibling)
    .filter((sibling): sibling is MessageBranchSibling => sibling !== undefined)

  const total = Math.trunc(value.total)
  const currentIndex = Math.trunc(value.currentIndex)
  if (currentIndex >= total) return undefined

  return {
    messageId: value.messageId,
    currentIndex,
    total,
    siblings,
  }
}

/**
 * Read the typed branch descriptor off a message's metadata, if present.
 * Accepts either a metadata object or a message-shaped value carrying one.
 */
export function getMessageBranchInfo(
  source: { metadata?: unknown } | undefined
): MessageBranchInfo | undefined {
  if (!source) return undefined
  const metadata = source.metadata
  if (!isRecord(metadata)) return undefined
  return parseMessageBranchInfo(metadata.branch)
}

/**
 * Whether a branch descriptor has more than one sibling and is therefore worth
 * rendering navigation controls for.
 */
export function isNavigableBranch(
  branch: MessageBranchInfo | undefined
): branch is MessageBranchInfo {
  return Boolean(branch && branch.total >= 2)
}

type TurnMessageLike = { role?: string; metadata?: unknown }

/**
 * Resolve the branch descriptor to render for a turn, anchored on the user
 * message. A turn's alternatives come from either editing the prompt (user
 * siblings) or regenerating the response (assistant siblings); both are surfaced
 * on the user message so navigation always lives in one place.
 *
 * The user's own edit branch takes precedence; when the prompt itself wasn't
 * branched, the response's regenerate branch is shown instead. Returns
 * `undefined` for assistant messages and for turns with nothing to navigate.
 */
export function resolveTurnBranch(
  message: TurnMessageLike,
  responseMessage: TurnMessageLike | undefined
): MessageBranchInfo | undefined {
  if (message.role !== "user") return undefined

  const ownBranch = getMessageBranchInfo(message)
  if (isNavigableBranch(ownBranch)) return ownBranch

  if (responseMessage?.role === "assistant") {
    const responseBranch = getMessageBranchInfo(responseMessage)
    if (isNavigableBranch(responseBranch)) return responseBranch
  }

  return undefined
}
