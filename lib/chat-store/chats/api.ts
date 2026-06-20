import { isLocalChatId } from "../identity"
import {
  deleteFromIndexedDB,
  readFromIndexedDB,
  writeToIndexedDB,
} from "../persist"
import type { Chats } from "../types"

const emptyChats: Chats[] = []

let cachedChatsSnapshot: Chats[] = emptyChats
let cachedChatsHydrated = false
let hydrateCachedChatsPromise: Promise<void> | null = null
const cachedChatsListeners = new Set<() => void>()

function sortChats(chats: Chats[]): Chats[] {
  return chats
    .slice()
    .sort(
      (a, b) =>
        +new Date(b.updated_at || b.created_at || "") -
        +new Date(a.updated_at || a.created_at || "")
    )
}

function isCachedChat(value: unknown): value is Chats {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    isLocalChatId((value as { id: string }).id)
  )
}

function emitCachedChatsChange() {
  for (const listener of cachedChatsListeners) {
    listener()
  }
}

function updateCachedChatsSnapshot(chats: Chats[]) {
  cachedChatsSnapshot = sortChats(
    chats.filter((chat) => isLocalChatId(chat.id))
  )
  emitCachedChatsChange()
}

export function getCachedChatsSnapshot(): Chats[] {
  return cachedChatsSnapshot
}

export function getCachedChatsServerSnapshot(): Chats[] {
  return emptyChats
}

export function getCachedChatsHydratedSnapshot(): boolean {
  return cachedChatsHydrated
}

export function subscribeCachedChats(listener: () => void): () => void {
  cachedChatsListeners.add(listener)
  void hydrateCachedChats()

  return () => {
    cachedChatsListeners.delete(listener)
  }
}

export async function hydrateCachedChats(): Promise<void> {
  if (cachedChatsHydrated) return
  if (hydrateCachedChatsPromise) return hydrateCachedChatsPromise

  hydrateCachedChatsPromise = getCachedChats()
    .then((chats) => {
      cachedChatsSnapshot = chats
      cachedChatsHydrated = true
      emitCachedChatsChange()
    })
    .finally(() => {
      hydrateCachedChatsPromise = null
    })

  return hydrateCachedChatsPromise
}

export async function getCachedChats(): Promise<Chats[]> {
  const entries = await readFromIndexedDB<Chats>("chats")
  const chats = Array.isArray(entries) ? entries : entries ? [entries] : []

  return sortChats(chats.filter(isCachedChat))
}

export async function getCachedChat(id: string): Promise<Chats | undefined> {
  if (!isLocalChatId(id)) return undefined

  const cached = cachedChatsSnapshot.find((chat) => chat.id === id)
  if (cached) return cached

  const entry = await readFromIndexedDB<Chats>("chats", id)
  return isCachedChat(entry) ? entry : undefined
}

export async function cacheChat(chat: Chats): Promise<void> {
  if (!isLocalChatId(chat.id)) return

  cachedChatsHydrated = true
  updateCachedChatsSnapshot([
    chat,
    ...cachedChatsSnapshot.filter((candidate) => candidate.id !== chat.id),
  ])

  await writeToIndexedDB("chats", chat)
}

export async function deleteCachedChat(id: string): Promise<void> {
  if (!isLocalChatId(id)) return

  cachedChatsHydrated = true
  updateCachedChatsSnapshot(
    cachedChatsSnapshot.filter((candidate) => candidate.id !== id)
  )

  await deleteFromIndexedDB("chats", id)
}

export function resetCachedChatsSnapshot(): void {
  cachedChatsSnapshot = emptyChats
  cachedChatsHydrated = false
  hydrateCachedChatsPromise = null
  emitCachedChatsChange()
}
