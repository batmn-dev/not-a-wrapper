import type { DurableMessageStatus } from "@/lib/chat-messages/durable-contract"
import type { UIMessage } from "ai"
import { readFromIndexedDB, writeToIndexedDB } from "../persist"

// Extended UIMessage type for app compatibility (includes optional properties from v4)
export type ExtendedUIMessage = UIMessage & {
  createdAt?: Date
  content?: string
  status?: DurableMessageStatus
  metadata?: unknown
}

// Cache Operations (IndexedDB)

type ChatMessageEntry = {
  id: string
  messages: ExtendedUIMessage[]
}

const emptyMessages: ExtendedUIMessage[] = []

const cachedMessagesSnapshots = new Map<string, ExtendedUIMessage[]>()
const hydratedCachedMessages = new Set<string>()
const hydrateCachedMessagesPromises = new Map<string, Promise<void>>()
const cachedMessagesListeners = new Map<string, Set<() => void>>()

function getCreatedAtTime(message: ExtendedUIMessage): number | null {
  if (message.createdAt === undefined) return null

  const time = new Date(message.createdAt).getTime()
  return Number.isNaN(time) ? null : time
}

function normalizeMissingCreatedAt(
  messages: ExtendedUIMessage[]
): ExtendedUIMessage[] {
  const knownTimes = messages.map((message) => getCreatedAtTime(message))
  const fallbackBase = Date.now()

  return messages.map((message, index) => {
    if (knownTimes[index] !== null) return message

    let previousKnownIndex = -1
    for (let candidate = index - 1; candidate >= 0; candidate--) {
      if (knownTimes[candidate] !== null) {
        previousKnownIndex = candidate
        break
      }
    }

    let nextKnownIndex = -1
    for (
      let candidate = index + 1;
      candidate < knownTimes.length;
      candidate++
    ) {
      if (knownTimes[candidate] !== null) {
        nextKnownIndex = candidate
        break
      }
    }

    const previousKnownTime =
      previousKnownIndex === -1 ? null : knownTimes[previousKnownIndex]
    const nextKnownTime =
      nextKnownIndex === -1 ? null : knownTimes[nextKnownIndex]

    let fallbackTime = fallbackBase + index
    if (previousKnownTime !== null) {
      fallbackTime = previousKnownTime + (index - previousKnownIndex)
    } else if (nextKnownTime !== null) {
      fallbackTime = nextKnownTime - (nextKnownIndex - index)
    }

    return { ...message, createdAt: new Date(fallbackTime) }
  })
}

function sortMessages(messages: ExtendedUIMessage[]): ExtendedUIMessage[] {
  return normalizeMissingCreatedAt(messages)
    .map((message, index) => {
      return {
        index,
        message,
        time: getCreatedAtTime(message),
      }
    })
    .sort((a, b) => {
      if (a.time === null || b.time === null) return a.index - b.index
      return a.time - b.time || a.index - b.index
    })
    .map(({ message }) => message)
}

function getListeners(chatId: string): Set<() => void> {
  const existing = cachedMessagesListeners.get(chatId)
  if (existing) return existing

  const listeners = new Set<() => void>()
  cachedMessagesListeners.set(chatId, listeners)
  return listeners
}

function emitCachedMessagesChange(chatId: string) {
  for (const listener of getListeners(chatId)) {
    listener()
  }
}

function updateCachedMessagesSnapshot(
  chatId: string,
  messages: ExtendedUIMessage[]
) {
  cachedMessagesSnapshots.set(chatId, sortMessages(messages))
  emitCachedMessagesChange(chatId)
}

export function getCachedMessagesSnapshot(
  chatId: string | null | undefined
): ExtendedUIMessage[] {
  if (!chatId) return emptyMessages
  return cachedMessagesSnapshots.get(chatId) ?? emptyMessages
}

export function getCachedMessagesServerSnapshot(): ExtendedUIMessage[] {
  return emptyMessages
}

export function subscribeCachedMessages(
  chatId: string,
  listener: () => void
): () => void {
  getListeners(chatId).add(listener)
  void hydrateCachedMessages(chatId)

  return () => {
    getListeners(chatId).delete(listener)
  }
}

export async function hydrateCachedMessages(chatId: string): Promise<void> {
  if (hydratedCachedMessages.has(chatId)) return

  const existing = hydrateCachedMessagesPromises.get(chatId)
  if (existing) return existing

  const promise = getCachedMessages(chatId)
    .then((messages) => {
      if (hydratedCachedMessages.has(chatId)) return

      cachedMessagesSnapshots.set(chatId, messages)
      hydratedCachedMessages.add(chatId)
      emitCachedMessagesChange(chatId)
    })
    .finally(() => {
      hydrateCachedMessagesPromises.delete(chatId)
    })

  hydrateCachedMessagesPromises.set(chatId, promise)
  return promise
}

export async function getCachedMessages(
  chatId: string
): Promise<ExtendedUIMessage[]> {
  const entry = await readFromIndexedDB<ChatMessageEntry>("messages", chatId)

  if (!entry || Array.isArray(entry)) return []

  return sortMessages(entry.messages || [])
}

export async function cacheMessages(
  chatId: string,
  messages: ExtendedUIMessage[]
): Promise<void> {
  updateCachedMessagesSnapshot(chatId, messages)
  hydratedCachedMessages.add(chatId)

  await writeToIndexedDB("messages", { id: chatId, messages })
}

export async function clearMessagesCache(chatId: string): Promise<void> {
  await cacheMessages(chatId, [])
}

export function resetCachedMessagesSnapshot(chatId?: string): void {
  if (chatId) {
    cachedMessagesSnapshots.delete(chatId)
    hydratedCachedMessages.delete(chatId)
    hydrateCachedMessagesPromises.delete(chatId)
    emitCachedMessagesChange(chatId)
    return
  }

  const changedChatIds = new Set<string>([
    ...cachedMessagesSnapshots.keys(),
    ...cachedMessagesListeners.keys(),
  ])
  cachedMessagesSnapshots.clear()
  hydratedCachedMessages.clear()
  hydrateCachedMessagesPromises.clear()

  for (const changedChatId of changedChatIds) {
    emitCachedMessagesChange(changedChatId)
  }
}
