export const LOCAL_CHAT_ID_PREFIX = "local-"
export const OPTIMISTIC_ID_PREFIX = "optimistic-"
export const OPTIMISTIC_EDIT_MESSAGE_ID_PREFIX = "optimistic-edit-"
export const GUEST_USER_ID_PREFIX = "guest_"

export const GUEST_USER_STORAGE_KEY = "guestUserId"
export const GUEST_CHAT_STORAGE_KEY = "guestChatId"

export type LocalChatId = `${typeof LOCAL_CHAT_ID_PREFIX}${string}`
export type OptimisticChatId = `${typeof OPTIMISTIC_ID_PREFIX}${string}`
export type OptimisticMessageId = `${typeof OPTIMISTIC_ID_PREFIX}${string}`
export type OptimisticEditMessageId =
  `${typeof OPTIMISTIC_EDIT_MESSAGE_ID_PREFIX}${string}`
export type GuestUserId = `${typeof GUEST_USER_ID_PREFIX}${string}`

export type ChatPersistenceMode =
  | "guestLocal"
  | "optimisticServer"
  | "durableServer"
  | "sharedReadOnly"

export type MessagePersistenceMode = "localOnly" | "optimistic" | "server"

type ChatPersistenceOptions = {
  isSharedReadOnly?: boolean
}

function createPrefixedId<TPrefix extends string>(
  prefix: TPrefix,
  randomId: () => string = () => crypto.randomUUID()
): `${TPrefix}${string}` {
  return `${prefix}${randomId()}`
}

export function createLocalChatId(
  randomId?: () => string
): LocalChatId {
  return createPrefixedId(LOCAL_CHAT_ID_PREFIX, randomId)
}

export function createOptimisticChatId(
  randomId?: () => string
): OptimisticChatId {
  return createPrefixedId(OPTIMISTIC_ID_PREFIX, randomId)
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

export function isLocalChatId(id: string | null | undefined): id is LocalChatId {
  return typeof id === "string" && id.startsWith(LOCAL_CHAT_ID_PREFIX)
}

export function isOptimisticChatId(
  id: string | null | undefined
): id is OptimisticChatId {
  return typeof id === "string" && id.startsWith(OPTIMISTIC_ID_PREFIX)
}

export function isServerChatId(id: string | null | undefined): id is string {
  return Boolean(id && !isLocalChatId(id) && !isOptimisticChatId(id))
}

export function isLocalMessageId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(LOCAL_CHAT_ID_PREFIX)
}

export function isOptimisticMessageId(
  id: string | null | undefined
): id is OptimisticMessageId {
  return typeof id === "string" && id.startsWith(OPTIMISTIC_ID_PREFIX)
}

export function isGuestUserId(id: string | null | undefined): id is GuestUserId {
  return typeof id === "string" && id.startsWith(GUEST_USER_ID_PREFIX)
}

export function getChatPersistenceMode(
  chatId: string,
  options: ChatPersistenceOptions = {}
): ChatPersistenceMode {
  if (options.isSharedReadOnly) return "sharedReadOnly"
  if (isLocalChatId(chatId)) return "guestLocal"
  if (isOptimisticChatId(chatId)) return "optimisticServer"
  return "durableServer"
}

export function getMessagePersistenceMode(
  chatId: string,
  options: ChatPersistenceOptions = {}
): MessagePersistenceMode {
  const chatMode = getChatPersistenceMode(chatId, options)

  if (chatMode === "guestLocal" || chatMode === "sharedReadOnly") {
    return "localOnly"
  }

  if (chatMode === "optimisticServer") return "optimistic"

  return "server"
}
