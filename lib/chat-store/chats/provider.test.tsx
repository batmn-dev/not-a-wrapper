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
import { ChatsProvider, useChats, type FirstTurnChat } from "./provider"

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
  toast: vi.fn(),
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
  // ENABLE_PAGINATED_SIDEBAR defaults on. Guest tests remain unsubscribed, but
  // the provider still calls the paginated hook with "skip", so it must exist.
  usePaginatedQuery: () => ({
    results: [],
    status: "Exhausted" as const,
    isLoading: false,
    loadMore: () => {},
  }),
}))

vi.mock("@/components/ui/toast", () => ({
  toast: convexMocks.toast,
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
    convexMocks.toast.mockReset()
    convexMocks.useQuery.mockClear()
    resetCachedChatsSnapshot()
    resetCachedMessagesSnapshot()
  })

  afterEach(() => {
    vi.useRealTimers()
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

  function renderProvider(
    captureRef: { current: ReturnType<typeof useChats> | null },
    userId?: string
  ) {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    rerenderProvider(captureRef, userId)
  }

  function rerenderProvider(
    captureRef: { current: ReturnType<typeof useChats> | null },
    userId?: string
  ) {
    act(() => {
      root?.render(
        <ChatsProvider userId={userId}>
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

    let deleted: boolean | undefined
    await act(async () => {
      deleted = await capture.current?.deleteChat(
        "local-existing",
        "local-existing"
      )
    })

    expect(deleted).toBe(true)
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

  it("reports failed durable deletion to callers", async () => {
    convexMocks.isAuthenticated = true
    convexMocks.queryValue = []
    convexMocks.mutationFn.mockRejectedValue(new Error("delete failed"))
    const capture: { current: ReturnType<typeof useChats> | null } = {
      current: null,
    }

    renderProvider(capture, "user-1")
    await flushPromises()

    let deleted: boolean | undefined
    await act(async () => {
      deleted = await capture.current?.deleteChat("chat-server", "chat-server")
    })

    expect(deleted).toBe(false)
    expect(convexMocks.mutationFn).toHaveBeenCalledWith({
      chatId: "chat-server",
    })
    expect(convexMocks.toast).toHaveBeenCalledWith({
      title: "Failed to delete chat",
      status: "error",
    })
  })

  it("creates authenticated first-turn chats through the atomic Convex mutation", async () => {
    convexMocks.isAuthenticated = true
    convexMocks.mutationFn.mockResolvedValue({
      chatId: "chat-server",
      userMessageId: "msg_first",
      attachments: [],
    })
    const capture: { current: ReturnType<typeof useChats> | null } = {
      current: null,
    }

    renderProvider(capture, "user-1")
    await flushPromises()

    let created: FirstTurnChat | undefined
    await act(async () => {
      created = await capture.current?.createFirstTurnChat({
        title: "Question",
        model: "gpt-5-mini",
        systemPrompt: "system",
        message: { clientMessageId: "optimistic-1", text: "Question" },
        attachmentIds: [],
      })
    })

    expect(convexMocks.mutationFn).toHaveBeenCalledWith({
      title: "Question",
      model: "gpt-5-mini",
      systemPrompt: "system",
      projectId: undefined,
      message: { clientMessageId: "optimistic-1", text: "Question" },
      attachmentIds: [],
    })
    expect(created).toMatchObject({
      kind: "durable",
      userMessageId: "msg_first",
      chat: {
        id: "chat-server",
        user_id: "user-1",
        project_id: null,
      },
    })
    expect(persistMocks.writeToIndexedDB).not.toHaveBeenCalled()
  })

  it("creates signed-out chats locally with the explicit guest identity", async () => {
    const capture: { current: ReturnType<typeof useChats> | null } = {
      current: null,
    }

    renderProvider(capture)
    await flushPromises()

    let created: FirstTurnChat | undefined
    await act(async () => {
      created = await capture.current?.createFirstTurnChat({
        guestUserId: "guest_1",
        title: "Guest question",
        message: { clientMessageId: "optimistic-1", text: "Guest question" },
        attachmentIds: [],
      })
    })

    expect(created).toMatchObject({
      kind: "local",
      chat: {
        id: expect.stringMatching(/^local-/),
        user_id: "guest_1",
        title: "Guest question",
        model: "gpt-5-mini",
      },
    })
    expect(convexMocks.mutationFn).not.toHaveBeenCalled()
    expect(persistMocks.writeToIndexedDB).toHaveBeenCalledWith(
      "chats",
      expect.objectContaining({ user_id: "guest_1" })
    )
  })

  it("fails closed on a guest first turn carrying staged attachments", async () => {
    const capture: { current: ReturnType<typeof useChats> | null } = {
      current: null,
    }

    renderProvider(capture)
    await flushPromises()

    // Staged attachments only exist for authenticated users; their presence on
    // a guest-shaped creation is a wrong-identity signal, so nothing is created.
    await expect(
      capture.current?.createFirstTurnChat({
        guestUserId: "guest_1",
        title: "Guest question",
        message: { clientMessageId: "optimistic-1", text: "Guest question" },
        attachmentIds: ["attachment-1"],
      })
    ).resolves.toBeUndefined()
    expect(convexMocks.mutationFn).not.toHaveBeenCalled()
    expect(persistMocks.writeToIndexedDB).not.toHaveBeenCalled()
    expect(convexMocks.toast).toHaveBeenCalledWith({
      title: "Failed to create chat",
      status: "error",
    })
  })

  it("waits for Convex auth before creating a WorkOS-authenticated chat", async () => {
    convexMocks.isAuthenticated = false
    convexMocks.isLoading = true
    convexMocks.mutationFn.mockResolvedValue({
      chatId: "chat-auth-sync",
      userMessageId: "msg_first",
      attachments: [],
    })
    const capture: { current: ReturnType<typeof useChats> | null } = {
      current: null,
    }

    renderProvider(capture, "user-1")
    await flushPromises()

    let creationPromise: Promise<FirstTurnChat | undefined> | undefined
    act(() => {
      creationPromise = capture.current?.createFirstTurnChat({
        guestUserId: "guest-should-be-ignored",
        title: "During auth sync",
        message: { clientMessageId: "optimistic-1", text: "During auth sync" },
        attachmentIds: [],
      })
    })

    expect(convexMocks.mutationFn).not.toHaveBeenCalled()
    expect(persistMocks.writeToIndexedDB).not.toHaveBeenCalled()

    convexMocks.isAuthenticated = true
    convexMocks.isLoading = false
    rerenderProvider(capture, "user-1")

    let created: FirstTurnChat | undefined
    await act(async () => {
      created = await creationPromise
    })

    expect(created).toMatchObject({
      kind: "durable",
      chat: {
        id: "chat-auth-sync",
        user_id: "user-1",
      },
    })
    expect(convexMocks.mutationFn).toHaveBeenCalledTimes(1)
    expect(persistMocks.writeToIndexedDB).not.toHaveBeenCalled()
  })

  it("fails a durable creation after Convex auth readiness times out", async () => {
    vi.useFakeTimers()
    convexMocks.isAuthenticated = false
    convexMocks.isLoading = true
    const capture: { current: ReturnType<typeof useChats> | null } = {
      current: null,
    }

    renderProvider(capture, "user-1")
    await flushPromises()

    let creationPromise: Promise<FirstTurnChat | undefined> | undefined
    act(() => {
      creationPromise = capture.current?.createFirstTurnChat({
        title: "During stalled auth sync",
        message: {
          clientMessageId: "optimistic-1",
          text: "During stalled auth sync",
        },
        attachmentIds: [],
      })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })

    await expect(creationPromise).resolves.toBeUndefined()
    expect(convexMocks.mutationFn).not.toHaveBeenCalled()
    expect(convexMocks.toast).toHaveBeenCalledWith({
      title: "Failed to create chat",
      status: "error",
    })
  })

  it("does not create a local chat while auth is unresolved without an app user", async () => {
    convexMocks.isLoading = true
    const capture: { current: ReturnType<typeof useChats> | null } = {
      current: null,
    }

    renderProvider(capture)
    await flushPromises()

    await expect(
      capture.current?.createFirstTurnChat({
        guestUserId: "guest_1",
        message: { clientMessageId: "optimistic-1", text: "hello" },
        attachmentIds: [],
      })
    ).resolves.toBeUndefined()
    expect(convexMocks.mutationFn).not.toHaveBeenCalled()
    expect(persistMocks.writeToIndexedDB).not.toHaveBeenCalled()
    expect(convexMocks.toast).toHaveBeenCalledWith({
      title: "Failed to create chat",
      status: "error",
    })
  })

  it("preserves project association and authenticated default-model selection", async () => {
    convexMocks.isAuthenticated = true
    convexMocks.mutationFn.mockResolvedValue({
      chatId: "chat-project",
      userMessageId: "msg_first",
      attachments: [],
    })
    const capture: { current: ReturnType<typeof useChats> | null } = {
      current: null,
    }

    renderProvider(capture, "user-1")
    await flushPromises()

    let created: FirstTurnChat | undefined
    await act(async () => {
      created = await capture.current?.createFirstTurnChat({
        title: "Project question",
        projectId: "project-1",
        message: { clientMessageId: "optimistic-1", text: "Project question" },
        attachmentIds: [],
      })
    })

    expect(convexMocks.mutationFn).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5-mini",
        projectId: "project-1",
      })
    )
    expect(created?.chat.project_id).toBe("project-1")
  })

  it("rolls back an optimistic chat when durable creation fails", async () => {
    convexMocks.isAuthenticated = true
    convexMocks.mutationFn.mockRejectedValue(new Error("write failed"))
    const capture: { current: ReturnType<typeof useChats> | null } = {
      current: null,
    }

    renderProvider(capture, "user-1")
    await flushPromises()

    await act(async () => {
      await expect(
        capture.current?.createFirstTurnChat({
          title: "Question",
          message: { clientMessageId: "optimistic-1", text: "Question" },
          attachmentIds: [],
        })
      ).resolves.toBeUndefined()
    })

    expect(
      capture.current?.chats.some((chat) => chat.id.startsWith("optimistic-"))
    ).toBe(false)
    expect(convexMocks.toast).toHaveBeenCalledWith({
      title: "Failed to create chat",
      status: "error",
    })
  })
})
