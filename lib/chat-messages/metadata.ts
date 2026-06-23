/**
 * Message metadata module — the single front door for reading and writing a
 * chat message's `metadata`.
 *
 * Before this module the metadata object was a shallow, leaky data structure:
 * the `isRecord` guard was reimplemented at three sites, the set of
 * server-owned keys was declared once but hand-copied by a second writer with
 * nothing linking them, and ~14 call sites poked keys directly through
 * `metadata as Record<string, unknown>`. Dropping a key in one writer silently
 * desynced the other.
 *
 * This module owns that knowledge:
 *   - one `isRecord` guard (re-exported from `branch.ts`, the lower module that
 *     also needs it for descriptor parsing);
 *   - one definition of the server-owned key-set ({@link SERVER_OWNED_METADATA_KEYS});
 *   - the typed readers ({@link getServerMessageId}, {@link getBranch}); and
 *   - the two writers every caller goes through:
 *       {@link stampServerFields} — projects a stored message's durable fields
 *         into metadata (the durable adapter's job), mode-gated; and
 *       {@link adoptServerOwned} — merges a server message's owned metadata onto
 *         a live one (the branch projection's job), idempotent on no-op.
 *
 * Branch stays a transient, droppable descriptor; both writers normalize /
 * clear it rather than assuming it round-trips. Client-owned transient keys
 * (e.g. `reasoningDurationMs`) are preserved untouched — the writers only ever
 * touch the keys they own.
 */

import {
  getMessageBranchInfo,
  isNavigableBranch,
  isRecord,
  parseMessageBranchInfo,
  readServerMessageId,
  resolveTurnBranch,
  type MessageBranchInfo,
} from "./branch"

export {
  isRecord,
  isNavigableBranch,
  resolveTurnBranch,
  type MessageBranchInfo,
}

/**
 * The metadata mode a durable message is projected into.
 *  - `extended`: the full set of server-owned telemetry keys (the default for
 *    rendered, persisted chats).
 *  - `runtime`: a minimal subset for in-flight replay — identity, status, and
 *    error only — so streaming replay does not carry stale telemetry.
 */
export type MetadataMode = "extended" | "runtime"

/**
 * The mapping from a stored message's durable Doc field to the metadata key it
 * is projected onto. This is the single source of truth for "which fields the
 * server owns in metadata": both writers and the drift test derive from it.
 *
 * Two fields are renamed on the way in (`status` → `durableStatus`,
 * `error` → `durableError`); the rest keep their name.
 */
const DURABLE_FIELD_MAP = [
  ["durableStatus", "status"],
  ["durableError", "error"],
  ["generationRunId", "generationRunId"],
  ["requestId", "requestId"],
  ["model", "model"],
  ["provider", "provider"],
  ["finishReason", "finishReason"],
  ["usage", "usage"],
] as const

/** A metadata key the server owns (the projection of a durable Doc field). */
export type ServerOwnedMetadataKey = (typeof DURABLE_FIELD_MAP)[number][0]

/**
 * The canonical set of server-owned metadata keys. Exported only so the drift
 * test can assert the writers agree with it — no production caller should branch
 * on it; the writers below own all reads and writes of these keys.
 */
export const SERVER_OWNED_METADATA_KEYS: readonly ServerOwnedMetadataKey[] =
  DURABLE_FIELD_MAP.map(([metadataKey]) => metadataKey)

/** Keys projected in `runtime` mode (a subset of the server-owned set). */
const RUNTIME_METADATA_KEYS: readonly ServerOwnedMetadataKey[] = [
  "durableStatus",
  "durableError",
]

/**
 * Read the server message id off a message's metadata. Single typed accessor —
 * callers must not reach for `metadata.serverMessageId` independently.
 */
export function getServerMessageId(metadata: unknown): string | undefined {
  return readServerMessageId(metadata)
}

/**
 * Read the typed branch descriptor off a message (or its metadata), if present.
 */
export function getBranch(
  source: { metadata?: unknown } | undefined
): MessageBranchInfo | undefined {
  return getMessageBranchInfo(source)
}

/** The stored-message fields {@link stampServerFields} projects into metadata. */
export type DurableMetadataSource = {
  _id: string
  status?: unknown
  error?: unknown
  generationRunId?: unknown
  requestId?: unknown
  model?: unknown
  provider?: unknown
  finishReason?: unknown
  usage?: unknown
}

function baseRecord(metadata: unknown): Record<string, unknown> {
  return isRecord(metadata) ? { ...metadata } : {}
}

function normalizeBranchInPlace(metadata: Record<string, unknown>): void {
  if (!("branch" in metadata)) return
  const branch = parseMessageBranchInfo(metadata.branch)
  if (branch) metadata.branch = branch
  else delete metadata.branch
}

function clearServerOwnedMetadata(metadata: Record<string, unknown>): void {
  for (const key of SERVER_OWNED_METADATA_KEYS) {
    delete metadata[key]
  }
}

/**
 * Project a stored message's durable fields onto its metadata — the durable
 * adapter's write. Owns the field→key mapping, the mode gate, the server
 * message id stamp, and branch normalization. Returns a fresh metadata object.
 *
 * `extended` projects the full server-owned set; `runtime` projects identity,
 * status, and error only.
 */
export function stampServerFields(
  baseMetadata: unknown,
  source: DurableMetadataSource,
  mode: MetadataMode
): Record<string, unknown> {
  const metadata = baseRecord(baseMetadata)
  clearServerOwnedMetadata(metadata)
  metadata.serverMessageId = source._id

  const keys =
    mode === "runtime" ? RUNTIME_METADATA_KEYS : SERVER_OWNED_METADATA_KEYS
  for (const metadataKey of keys) {
    const sourceField = DURABLE_FIELD_MAP.find(
      ([key]) => key === metadataKey
    )?.[1]
    if (!sourceField) continue
    const value = (source as Record<string, unknown>)[sourceField]
    // `runtime` mode only stamps a truthy error; otherwise stamp any defined
    // value (preserving the prior `setIfDefined` semantics).
    if (mode === "runtime" && metadataKey === "durableError") {
      if (value) metadata[metadataKey] = value
    } else if (value !== undefined) {
      metadata[metadataKey] = value
    }
  }

  normalizeBranchInPlace(metadata)
  return metadata
}

/**
 * Merge a server message's identity, branch, and server-owned metadata onto a
 * live message's metadata — the branch projection's write. The server is the
 * source of truth for these keys: present keys are adopted, absent ones cleared.
 * Client-owned keys on `localMetadata` are preserved.
 *
 * Returns the original `localMetadata` reference when nothing changed, so the
 * projection stays idempotent (a no-op must not break referential memoization).
 */
export function adoptServerOwned(
  localMetadata: unknown,
  serverMetadata: unknown
): unknown {
  const serverMessageId = getServerMessageId(serverMetadata)
  const serverBranch = getBranch({ metadata: serverMetadata })

  const localMessageId = getServerMessageId(localMetadata)
  const localBranch = getBranch({ metadata: localMetadata })

  const localRecord = isRecord(localMetadata) ? localMetadata : undefined
  const serverRecord = isRecord(serverMetadata) ? serverMetadata : undefined

  const messageIdChanged =
    serverMessageId !== undefined && serverMessageId !== localMessageId
  const branchChanged = !branchEquals(localBranch, serverBranch)
  const serverOwnedChanged = SERVER_OWNED_METADATA_KEYS.some((key) => {
    const localHasKey = localRecord
      ? Object.prototype.hasOwnProperty.call(localRecord, key)
      : false
    const serverHasKey = serverRecord
      ? Object.prototype.hasOwnProperty.call(serverRecord, key)
      : false
    if (localHasKey !== serverHasKey) return true
    if (!serverHasKey || !localRecord || !serverRecord) return false
    return !metadataValueEquals(localRecord[key], serverRecord[key])
  })

  if (!messageIdChanged && !branchChanged && !serverOwnedChanged) {
    return localMetadata
  }

  const next: Record<string, unknown> = localRecord ? { ...localRecord } : {}

  if (serverMessageId !== undefined) next.serverMessageId = serverMessageId
  if (serverBranch !== undefined) next.branch = serverBranch
  else if ("branch" in next) delete next.branch
  for (const key of SERVER_OWNED_METADATA_KEYS) {
    if (serverRecord && key in serverRecord) next[key] = serverRecord[key]
    else delete next[key]
  }

  return next
}

function metadataValueEquals(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false
    }
    return a.every((value, index) => metadataValueEquals(value, b[index]))
  }
  if (isRecord(a) && isRecord(b)) {
    const aKeys = Object.keys(a)
    const bKeys = Object.keys(b)
    if (aKeys.length !== bKeys.length) return false
    return aKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(b, key) &&
        metadataValueEquals(a[key], b[key])
    )
  }
  return false
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
