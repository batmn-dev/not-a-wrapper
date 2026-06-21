/**
 * Selected-path projection — the single seam that installs the backend-derived
 * selected path into the live `useChat` turn array.
 *
 * The AI SDK's `useChat` holds only a flat, linear array with no concept of
 * branches (see the C2 brief). The backend owns message identity and the
 * selected path; the client must render it. This module projects the reactive
 * server selected path onto the live array while the chat is idle, in a way
 * that:
 *
 *   - adopts server identity (message id, createdAt) and the typed branch
 *     descriptor onto matching live messages — including ones several turns
 *     back, so deep edits no longer keep a stale optimistic id;
 *   - never drops in-flight messages the server has not persisted yet (the
 *     brief's "lag window"); and
 *   - swaps wholesale to the server path when the selection diverged (a branch
 *     switch / sibling selection), since the server is authoritative for which
 *     messages are on the path.
 *
 * It operates purely on arrays so it can be unit-tested without React.
 */

import {
  getMessageBranchInfo,
  type MessageBranchInfo,
} from "@/lib/chat-messages/branch"
import type { ChatTurnMessage } from "./chat-turn-service"

const serverOwnedMetadataKeys = [
  "durableStatus",
  "durableError",
  "generationRunId",
  "requestId",
  "model",
  "provider",
  "finishReason",
  "usage",
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function readServerMessageId(metadata: unknown): string | undefined {
  if (!isRecord(metadata)) return undefined
  const value = metadata.serverMessageId
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function createdAtMs(value: unknown): number | undefined {
  return value instanceof Date ? value.getTime() : undefined
}

function branchEquals(
  a: MessageBranchInfo | undefined,
  b: MessageBranchInfo | undefined
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (
    a.messageId !== b.messageId ||
    a.currentIndex !== b.currentIndex ||
    a.total !== b.total ||
    a.siblings.length !== b.siblings.length
  ) {
    return false
  }
  return a.siblings.every((sibling, index) => {
    const other = b.siblings[index]
    return (
      other !== undefined &&
      sibling.messageId === other.messageId &&
      sibling.clientMessageId === other.clientMessageId
    )
  })
}

/**
 * Merge the server message's identity, branch, and lifecycle metadata into the
 * live message. Returns the original metadata reference when nothing changes so
 * callers can detect no-ops.
 */
function adoptServerMetadata(
  localMetadata: unknown,
  serverMetadata: unknown
): unknown {
  const serverMessageId = readServerMessageId(serverMetadata)
  const serverBranch = getMessageBranchInfo({ metadata: serverMetadata })

  const localMessageId = readServerMessageId(localMetadata)
  const localBranch = getMessageBranchInfo({ metadata: localMetadata })

  const messageIdChanged =
    serverMessageId !== undefined && serverMessageId !== localMessageId
  // The server is the source of truth for branch state: adopt it, and clear a
  // stale descriptor when the message no longer has siblings.
  const branchChanged = !branchEquals(localBranch, serverBranch)

  const localMetadataRecord = isRecord(localMetadata) ? localMetadata : undefined
  const serverMetadataRecord = isRecord(serverMetadata) ? serverMetadata : undefined
  const serverOwnedMetadataChanged = serverOwnedMetadataKeys.some((key) => {
    const localHasKey = localMetadataRecord
      ? Object.prototype.hasOwnProperty.call(localMetadataRecord, key)
      : false
    const serverHasKey = serverMetadataRecord
      ? Object.prototype.hasOwnProperty.call(serverMetadataRecord, key)
      : false
    if (localHasKey !== serverHasKey) return true
    if (!serverHasKey || !localMetadataRecord || !serverMetadataRecord) {
      return false
    }
    return !Object.is(localMetadataRecord[key], serverMetadataRecord[key])
  })

  if (!messageIdChanged && !branchChanged && !serverOwnedMetadataChanged) {
    return localMetadata
  }

  const next: Record<string, unknown> = localMetadataRecord
    ? { ...localMetadataRecord }
    : {}

  if (serverMessageId !== undefined) next.serverMessageId = serverMessageId
  if (serverBranch !== undefined) next.branch = serverBranch
  else if ("branch" in next) delete next.branch
  for (const key of serverOwnedMetadataKeys) {
    if (serverMetadataRecord && key in serverMetadataRecord) {
      next[key] = serverMetadataRecord[key]
    } else {
      delete next[key]
    }
  }

  return next
}

/**
 * Adopt server branch metadata + `serverMessageId` onto the live array by
 * matching messages by **identity**, not position.
 *
 * Identity matching (id / serverMessageId cross-keys) is what makes this safe:
 * the server persists user/edit messages with `clientMessageId = the client id`
 * and the streamed assistant carries the server id as its `id`, so the same
 * message always shares a key. A live optimistic send that the server has not
 * persisted yet matches nothing and is left untouched — positional-by-role
 * matching, by contrast, would mis-associate it with a prior same-role server
 * message and rewrite it on every cycle (an infinite render loop). Messages
 * whose id genuinely diverged (e.g. an edit's SDK-minted id) are not reconciled
 * here; `isSelectedPathDivergent` routes those to a wholesale swap instead.
 *
 * Returns the original `live` reference when nothing changes (idempotent).
 */
export function reconcileSelectedPath(
  live: ChatTurnMessage[],
  serverPath: ChatTurnMessage[]
): ChatTurnMessage[] {
  if (live.length === 0 || serverPath.length === 0) return live

  const serverByKey = new Map<string, ChatTurnMessage>()
  for (const serverMessage of serverPath) {
    for (const key of identityKeys(serverMessage)) {
      if (!serverByKey.has(key)) serverByKey.set(key, serverMessage)
    }
  }

  let changed = false
  const updated = live.map((localMessage) => {
    let match: ChatTurnMessage | undefined
    for (const key of identityKeys(localMessage)) {
      match = serverByKey.get(key)
      if (match) break
    }
    if (!match || match.role !== localMessage.role) return localMessage

    const mergedMetadata = adoptServerMetadata(
      localMessage.metadata,
      match.metadata
    )
    const metadataChanged = mergedMetadata !== localMessage.metadata

    // Adopt the server's canonical createdAt. A streamed message's client-side
    // createdAt can drift from the persisted value, which makes the server's
    // edit/regenerate version guard (which compares createdAt) falsely reject a
    // later action against this message.
    const serverCreatedAt = match.createdAt
    const createdAtChanged =
      serverCreatedAt instanceof Date &&
      createdAtMs(localMessage.createdAt) !== serverCreatedAt.getTime()
    const statusChanged = localMessage.status !== match.status

    if (!metadataChanged && !createdAtChanged && !statusChanged) {
      return localMessage
    }

    changed = true
    return {
      ...localMessage,
      ...(metadataChanged ? { metadata: mergedMetadata } : {}),
      ...(createdAtChanged ? { createdAt: serverCreatedAt } : {}),
      ...(statusChanged ? { status: match.status } : {}),
    }
  })

  return changed ? updated : live
}

/**
 * Identity keys by which a live and a server message can be recognised as the
 * same message: the rendered id (clientMessageId) and the server message id.
 * A streamed assistant carries the server id as its `id` (via the route's
 * `generateMessageId`) before it is metadata-anchored, so cross-matching both
 * keys avoids treating it as "missing" during normal convergence.
 */
function identityKeys(message: ChatTurnMessage): string[] {
  const keys: string[] = []
  const id = String(message.id)
  if (id.length > 0) keys.push(id)
  const serverMessageId = readServerMessageId(message.metadata)
  if (serverMessageId !== undefined && serverMessageId !== id) {
    keys.push(serverMessageId)
  }
  return keys
}

function collectKeys(messages: ChatTurnMessage[]): Set<string> {
  const keys = new Set<string>()
  for (const message of messages) {
    for (const key of identityKeys(message)) keys.add(key)
  }
  return keys
}

/**
 * Whether the live array and the server selected path disagree about which
 * messages are on the path — as opposed to merely differing in identity
 * (optimistic id vs server id) or in trailing in-flight sends.
 *
 * Two divergence directions, both meaning "trust the server path wholesale":
 *  - removed: a message the client renders and has already anchored to a server
 *    id is no longer on the server path (a sibling branch was selected); and
 *  - missing: the server path contains an anchored message the client is no
 *    longer rendering (an edit/regenerate rejection sliced it out — the
 *    "branch-blind vanish"). Restoring it re-projects the last good path.
 *
 * Neither fires during a fresh send's persistence lag: the in-flight optimistic
 * messages are not yet anchored, and the streamed message matches the server
 * message by id.
 */
export function isSelectedPathDivergent(
  live: ChatTurnMessage[],
  serverPath: ChatTurnMessage[]
): boolean {
  if (serverPath.length === 0) return false

  const serverKeys = collectKeys(serverPath)
  const liveKeys = collectKeys(live)

  const removed = live.some((message) => {
    if (readServerMessageId(message.metadata) === undefined) return false
    return identityKeys(message).every((key) => !serverKeys.has(key))
  })
  if (removed) return true

  const missing = serverPath.some((message) =>
    identityKeys(message).every((key) => !liveKeys.has(key))
  )
  return missing
}

/**
 * Project the reactive server selected path onto the live turn array. Safe to
 * call on every idle reactive update: it is a no-op (returns the same `live`
 * reference) once the two have converged.
 */
export function projectSelectedPath(
  live: ChatTurnMessage[],
  serverPath: ChatTurnMessage[]
): ChatTurnMessage[] {
  if (serverPath.length === 0) return live
  // Nothing to preserve — install the server path directly.
  if (live.length === 0) return serverPath
  if (isSelectedPathDivergent(live, serverPath)) return serverPath
  return reconcileSelectedPath(live, serverPath)
}
