/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { resetCachedMessagesSnapshot } from "../messages/api"
import type { Chats } from "../types"
import { resetCachedChatsSnapshot } from "./api"
import { ChatsProvider, useChats } from "./provider"

const persistMocks = vi.hoisted(() => {
  const tables = {
    chats: new Map<string, unknown>(),
    messages: new Map<string, unknown>(),
    sync: new Map<string, unknown>(),
  }

  return {
    tables,
    readFromIndexedDB: vi.fn(
      async (table: keyof typeof tables, key?: string) => {
        if (key) return tables[table].get(key) ?? null
        return Array.from(tables[table].values())
      }
    ),
    writeToIndexedDB: vi.fn(
      async (
        table: keyof typeof tables,
        data: { id: string | number } | Array<{ id: string | number }>
      ) => {
        const rows = Array.isArray(data) ? data : [data]
        for (const row of rows) {
          tables[table].set(String(row.id), row)
        }
      }
    ),
    deleteFromIndexedDB: vi.fn(
      async (table: keyof typeof tables, key?: string) => {
        if (key) {
          tables[table].delete(key)
          return
        }
        tables[table].clear()
      }
    ),
  }
})

const convexMocks = vi.hoisted(() => ({
  isAuthenticated: false,
  isLoading: false,
  queryValue: undefined as unknown,
  mutationFn: vi.fn(),
  useQuery: vi.fn(),
}))

vi.mock("../persist", () => ({
  readFromIndexedDB: persistMocks.readFromIndexedDB,
  writeToIndexedDB: persistMocks.writeToIndexedDB,
  deleteFromIndexedDB: persistMocks.deleteFromIndexedDB,
}))

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({
    isAuthenticated: convexMocks.isAuthenticated,
    isLoading: convexMocks.isLoading,
  }),
  useMutation: () => convexMocks.mutationFn,
  useQuery: (...args: unknown[]) => {
    convexMocks.useQuery(...args)
    return convexMocks.queryValue
  },
  // ENABLE_PAGINATED_SIDEBAR is off in tests; the paginated sidebar hook is still
  // called (with "skip"), so it must exist. Guest tests don't exercise it.
  usePaginatedQuery: () => ({
    results: [],
    status: "Exhausted" as const,
    isLoading: false,
    loadMore: () => {},
  }),
}))

vi.mock("@/components/ui/toast", () => ({
  toast: vi.fn(),
}))

function localChat(overrides: Partial<Chats> = {}): Chats {
  return {
    id: "local-existing",
    title: "Existing local chat",
    model: "openai/gpt-5-mini",
    system_prompt: "system",
    user_id: "guest_1",
    public: false,
    project_id: null,
    pinned: false,
    pinned_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

function flushPromises() {
  return act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function ChatsSnapshot({
  captureRef,
}: {
  captureRef: { current: ReturnType<typeof useChats> | null }
}) {
  const context = useChats()
  React.useEffect(() => {
    captureRef.current = context
  }, [captureRef, context])

  return (
    <div
      data-chats={context.chats.map((chat) => chat.id).join(",")}
      data-loading={String(context.isLoading)}
    />
  )
}

describe("ChatsProvider guest local chats", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeAll(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  beforeEach(() => {
    for (const table of Object.values(persistMocks.tables)) {
      table.clear()
    }
    persistMocks.readFromIndexedDB.mockClear()
    persistMocks.writeToIndexedDB.mockClear()
    persistMocks.deleteFromIndexedDB.mockClear()
    convexMocks.isAuthenticated = false
    convexMocks.isLoading = false
    convexMocks.queryValue = undefined
    convexMocks.mutationFn.mockReset()
    convexMocks.useQuery.mockClear()
    resetCachedChatsSnapshot()
    resetCachedMessagesSnapshot()
  })

  afterEach(() => {
    const mountedRoot = root
    if (mountedRoot) {
      act(() => {
        mountedRoot.unmount()
      })
    }
    container?.remove()
    container = null
    root = null
  })

  function renderProvider(captureRef: {
    current: ReturnType<typeof useChats> | null
  }) {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <ChatsProvider>
          <ChatsSnapshot captureRef={captureRef} />
        </ChatsProvider>
      )
    })
  }

  it("hydrates local chat metadata for guests without querying Convex", async () => {
    persistMocks.tables.chats.set("local-existing", localChat())
    const capture: { current: ReturnType<typeof useChats> | null } = {
      current: null,
    }

    renderProvider(capture)
    await flushPromises()

    expect(capture.current?.isLoading).toBe(false)
    expect(capture.current?.chats.map((chat) => chat.id)).toEqual([
      "local-existing",
    ])
    expect(convexMocks.useQuery).toHaveBeenCalledWith(expect.anything(), "skip")
  })

  it("updates, pins, bumps, and deletes local chats through IndexedDB without Convex mutations", async () => {
    persistMocks.tables.chats.set("local-existing", localChat())
    persistMocks.tables.messages.set("local-existing", {
      id: "local-existing",
      messages: [{ id: "message-1", role: "user", parts: [] }],
    })
    const capture: { current: ReturnType<typeof useChats> | null } = {
      current: null,
    }

    renderProvider(capture)
    await flushPromises()
    convexMocks.mutationFn.mockClear()

    await act(async () => {
      await capture.current?.updateTitle("local-existing", "Renamed")
      await capture.current?.updateChatModel("local-existing", "openai/gpt-5")
      await capture.current?.togglePinned("local-existing", true)
      await capture.current?.bumpChat("local-existing")
    })

    const updated = persistMocks.tables.chats.get("local-existing") as Chats
    expect(updated.title).toBe("Renamed")
    expect(updated.model).toBe("openai/gpt-5")
    expect(updated.pinned).toBe(true)
    expect(updated.pinned_at).toBeTruthy()
    expect(convexMocks.mutationFn).not.toHaveBeenCalled()

    await act(async () => {
      await capture.current?.deleteChat("local-existing", "local-existing")
    })

    expect(persistMocks.tables.chats.has("local-existing")).toBe(false)
    expect(
      (
        persistMocks.tables.messages.get("local-existing") as {
          messages: unknown[]
        }
      ).messages
    ).toEqual([])
    expect(convexMocks.mutationFn).not.toHaveBeenCalled()
  })
})
