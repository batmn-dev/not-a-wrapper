import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Chats } from "../types"
import {
  cacheChat,
  getCachedChatsSnapshot,
  hydrateCachedChats,
  resetCachedChatsSnapshot,
  updateCachedChat,
} from "./api"

const persistMocks = vi.hoisted(() => ({
  deleteFromIndexedDB: vi.fn(async () => {}),
  readFromIndexedDB: vi.fn(
    async (
      _table: "chats" | "messages" | "sync",
      _key?: string
    ): Promise<Chats | Chats[] | null> => null
  ),
  writeToIndexedDB: vi.fn(async () => {}),
}))

vi.mock("../persist", () => persistMocks)

function localChat(id: string): Chats {
  return {
    id,
    user_id: "guest-1",
    title: "New chat",
    model: "gpt-5-mini",
    project_id: null,
    public: false,
    pinned: false,
    pinned_at: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: null,
  }
}

describe("updateCachedChat", () => {
  beforeEach(() => {
    resetCachedChatsSnapshot()
    persistMocks.deleteFromIndexedDB.mockClear()
    persistMocks.readFromIndexedDB.mockReset()
    persistMocks.readFromIndexedDB.mockResolvedValue(null)
    persistMocks.writeToIndexedDB.mockClear()
  })

  it("rejects an updater result for a different chat id", async () => {
    const original = localChat("local-original")
    await cacheChat(original)
    persistMocks.writeToIndexedDB.mockClear()

    await expect(
      updateCachedChat(original.id, (chat) => ({
        ...chat,
        id: "local-different",
        title: "Wrong chat",
      }))
    ).resolves.toBe(false)

    expect(getCachedChatsSnapshot()).toEqual([original])
    expect(persistMocks.writeToIndexedDB).not.toHaveBeenCalled()
  })

  it("preserves an update issued while the initial snapshot is hydrating", async () => {
    const stored = localChat("local-existing")
    let markHydrationStarted: (() => void) | undefined
    const hydrationStarted = new Promise<void>((resolve) => {
      markHydrationStarted = resolve
    })
    let releaseHydration: (() => void) | undefined
    const hydrationGate = new Promise<void>((resolve) => {
      releaseHydration = resolve
    })

    persistMocks.readFromIndexedDB.mockImplementation(async (_table, key) => {
      if (key) return stored
      markHydrationStarted?.()
      await hydrationGate
      return [stored]
    })

    const hydrationPromise = hydrateCachedChats()
    await hydrationStarted
    const updatePromise = updateCachedChat(stored.id, (chat) => ({
      ...chat,
      title: "Renamed during hydration",
    }))

    await Promise.resolve()
    releaseHydration?.()
    await Promise.all([hydrationPromise, updatePromise])

    expect(getCachedChatsSnapshot()).toEqual([
      { ...stored, title: "Renamed during hydration" },
    ])
  })
})
