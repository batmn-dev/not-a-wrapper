import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  cacheMessages,
  getCachedMessagesSnapshot,
  hydrateCachedMessages,
  resetCachedMessagesSnapshot,
  type ExtendedUIMessage,
} from "./api"

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, reject, resolve }
}

const persistMocks = vi.hoisted(() => {
  type TableName = "chats" | "messages" | "sync"
  type DeferredRead = {
    promise: Promise<unknown>
    resolve: (value: unknown) => void
  }

  const tables: Record<TableName, Map<string, unknown>> = {
    chats: new Map<string, unknown>(),
    messages: new Map<string, unknown>(),
    sync: new Map<string, unknown>(),
  }

  const state = {
    deferredRead: null as DeferredRead | null,
    tables,
    readFromIndexedDB: vi.fn(
      async (table: TableName, key?: string): Promise<unknown> => {
        if (state.deferredRead) {
          return await state.deferredRead.promise
        }

        if (key) return tables[table].get(key) ?? null
        return Array.from(tables[table].values())
      }
    ),
    writeToIndexedDB: vi.fn(
      async (
        table: TableName,
        data: { id: string | number } | Array<{ id: string | number }>
      ) => {
        const rows = Array.isArray(data) ? data : [data]
        for (const row of rows) {
          tables[table].set(String(row.id), row)
        }
      }
    ),
  }

  return state
})

vi.mock("../persist", () => ({
  readFromIndexedDB: persistMocks.readFromIndexedDB,
  writeToIndexedDB: persistMocks.writeToIndexedDB,
}))

function message(id: string, text: string): ExtendedUIMessage {
  return {
    id,
    role: "user",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    parts: [{ type: "text", text }],
  }
}

describe("cached messages API", () => {
  beforeEach(() => {
    for (const table of Object.values(persistMocks.tables)) {
      table.clear()
    }
    persistMocks.deferredRead = null
    persistMocks.readFromIndexedDB.mockClear()
    persistMocks.writeToIndexedDB.mockClear()
    resetCachedMessagesSnapshot()
  })

  it("does not let stale hydration overwrite newer cached messages", async () => {
    const staleMessages = [message("stale", "old")]
    const newerMessages = [message("newer", "current")]
    const deferredRead = createDeferred<unknown>()
    persistMocks.deferredRead = deferredRead

    const hydration = hydrateCachedMessages("chat-1")
    await cacheMessages("chat-1", newerMessages)

    expect(getCachedMessagesSnapshot("chat-1").map((item) => item.id)).toEqual([
      "newer",
    ])

    deferredRead.resolve({ id: "chat-1", messages: staleMessages })
    await hydration

    expect(getCachedMessagesSnapshot("chat-1").map((item) => item.id)).toEqual([
      "newer",
    ])
  })
})
