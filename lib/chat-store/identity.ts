export const OPTIMISTIC_ID_PREFIX = "optimistic-"
export const OPTIMISTIC_EDIT_MESSAGE_ID_PREFIX = "optimistic-edit-"
export const GUEST_USER_ID_PREFIX = "guest_"

export const GUEST_USER_STORAGE_KEY = "guestUserId"
export const GUEST_CHAT_STORAGE_KEY = "guestChatId"

export type OptimisticMessageId = `${typeof OPTIMISTIC_ID_PREFIX}${string}`
export type OptimisticEditMessageId =
  `${typeof OPTIMISTIC_EDIT_MESSAGE_ID_PREFIX}${string}`
export type GuestUserId = `${typeof GUEST_USER_ID_PREFIX}${string}`

/**
 * Chat identity is client-minted (ADR-0031): one UUID chosen at Send is the
 * route segment, the value every client-facing Convex function accepts, and
 * the chat document's `publicId`. Guests and signed-in users share the
 * scheme; whether a chat persists locally or durably is a property of the
 * caller's auth state, never of the id's shape.
 */
const CHAT_PUBLIC_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function createChatPublicId(
  randomId: () => string = () => crypto.randomUUID()
): string {
  return randomId()
}

export function isChatPublicId(id: unknown): id is string {
  return typeof id === "string" && CHAT_PUBLIC_ID_PATTERN.test(id)
}

/**
 * Typed creation conflict: the publicId already names a chat the caller must
 * not converge onto (another user's, or a different first turn). The client
 * re-mints exactly once.
 */
export const CHAT_PUBLIC_ID_CONFLICT_CODE = "chat_public_id_conflict" as const

export type ChatPersistenceMode =
  "guestLocal" | "durableServer" | "sharedReadOnly"

export type MessagePersistenceMode = "localOnly" | "server"

type ChatPersistenceOptions = {
  isSharedReadOnly?: boolean
}

function createPrefixedId<TPrefix extends string>(
  prefix: TPrefix,
  randomId: () => string = () => crypto.randomUUID()
): `${TPrefix}${string}` {
  return `${prefix}${randomId()}`
}

export function createOptimisticMessageId(
  randomId?: () => string
): OptimisticMessageId {
  return createPrefixedId(OPTIMISTIC_ID_PREFIX, randomId)
}

export function createOptimisticEditMessageId(
  randomId?: () => string
): OptimisticEditMessageId {
  return createPrefixedId(OPTIMISTIC_EDIT_MESSAGE_ID_PREFIX, randomId)
}

export function createGuestUserId(randomId?: () => string): GuestUserId {
  return createPrefixedId(GUEST_USER_ID_PREFIX, randomId)
}

export function isOptimisticMessageId(
  id: string | null | undefined
): id is OptimisticMessageId {
  return typeof id === "string" && id.startsWith(OPTIMISTIC_ID_PREFIX)
}

export function isOptimisticEditMessageId(
  id: string | null | undefined
): id is OptimisticEditMessageId {
  return (
    typeof id === "string" && id.startsWith(OPTIMISTIC_EDIT_MESSAGE_ID_PREFIX)
  )
}

export function isGuestUserId(
  id: string | null | undefined
): id is GuestUserId {
  return typeof id === "string" && id.startsWith(GUEST_USER_ID_PREFIX)
}

/** Guests persist chats in IndexedDB; signed-in users persist them in Convex. */
export function getChatPersistenceMode(
  isAuthenticated: boolean,
  options: ChatPersistenceOptions = {}
): ChatPersistenceMode {
  if (options.isSharedReadOnly) return "sharedReadOnly"
  return isAuthenticated ? "durableServer" : "guestLocal"
}

export function getMessagePersistenceMode(
  isAuthenticated: boolean,
  options: ChatPersistenceOptions = {}
): MessagePersistenceMode {
  return getChatPersistenceMode(isAuthenticated, options) === "durableServer"
    ? "server"
    : "localOnly"
}
