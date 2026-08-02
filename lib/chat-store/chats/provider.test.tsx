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
  paginationStatus: "Exhausted" as
    "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted",
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
  // The bounded sidebar is the only read path (ADR-0005). Guest tests remain
  // unsubscribed, but the provider still calls the paginated hook, so it must
  // exist.
  usePaginatedQuery: () => ({
    results: [],
    status: convexMocks.paginationStatus,
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

function durableChat() {
  return {
    _id: "chat-server",
    _creationTime: 1,
    userId: "user-1",
    title: "Durable chat",
    public: false,
    pinned: true,
    updatedAt: 1,
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
    convexMocks.paginationStatus = "Exhausted"
    convexMocks.queryValue = undefined
    convexMocks.mutationFn.mockReset()
    convexMocks.toast.mockReset()
    convexMocks.useQuery.mockClear()
    resetCachedChatsSnapshot()
    resetCachedMessagesSnapshot()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
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

  it("keeps initial and loading-more states distinct", async () => {
    convexMocks.isAuthenticated = true
    convexMocks.queryValue = []
    convexMocks.paginationStatus = "LoadingMore"
    const capture: { current: ReturnType<typeof useChats> | null } = {
      current: null,
    }

    renderProvider(capture, "user-1")
    await flushPromises()

    expect(capture.current?.isLoading).toBe(false)
    expect(capture.current?.isLoadingMore).toBe(true)
    expect(capture.current?.canLoadMore).toBe(false)

    convexMocks.paginationStatus = "Exhausted"
    rerenderProvider(capture, "user-1")

    expect(capture.current?.isLoadingMore).toBe(false)
    expect(capture.current?.canLoadMore).toBe(false)
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

  it("rolls back optimistic durable deletion and retains diagnostics on failure", async () => {
    convexMocks.isAuthenticated = true
    convexMocks.queryValue = [durableChat()]
    const error = new Error("delete failed")
    convexMocks.mutationFn.mockRejectedValue(error)
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const capture: { current: ReturnType<typeof useChats> | null } = {
      current: null,
    }

    renderProvider(capture, "user-1")
    await flushPromises()
    expect(capture.current?.chats.map((chat) => chat.id)).toEqual([
      "chat-server",
    ])

    let deleted: boolean | undefined
    await act(async () => {
      deleted = await capture.current?.deleteChat("chat-server", "chat-server")
    })

    expect(deleted).toBe(false)
    expect(capture.current?.chats.map((chat) => chat.id)).toEqual([
      "chat-server",
    ])
    expect(convexMocks.mutationFn).toHaveBeenCalledWith({
      chatId: "chat-server",
    })
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to delete durable chat:",
      error
    )
    expect(convexMocks.toast).toHaveBeenCalledWith({
      title: "Failed to delete chat",
      status: "error",
    })
  })

  it("keeps a durable chat deleted after server confirmation", async () => {
    convexMocks.isAuthenticated = true
    convexMocks.queryValue = [durableChat()]
    convexMocks.mutationFn.mockResolvedValue(undefined)
    const capture: { current: ReturnType<typeof useChats> | null } = {
      current: null,
    }

    renderProvider(capture, "user-1")
    await flushPromises()

    let deleted: boolean | undefined
    await act(async () => {
      deleted = await capture.current?.deleteChat("chat-server")
    })

    expect(deleted).toBe(true)
    expect(capture.current?.chats).toEqual([])
    expect(convexMocks.toast).not.toHaveBeenCalled()
  })

  it("absorbs a failed durable generated-title commit instead of rejecting", async () => {
    // The server's after() backstop owns durable title delivery; the client
    // commit is only the low-latency path, so its failure must resolve false
    // (a CAS miss) rather than escape as an unhandled rejection.
    convexMocks.isAuthenticated = true
    convexMocks.queryValue = [durableChat()]
    convexMocks.mutationFn.mockRejectedValue(new Error("network down"))
    const capture: { current: ReturnType<typeof useChats> | null } = {
      current: null,
    }

    renderProvider(capture, "user-1")
    await flushPromises()

    let applied: boolean | undefined
    await act(async () => {
      applied = await capture.current?.applyGeneratedTitle(
        "chat-server",
        "Late Title",
        1
      )
    })

    expect(applied).toBe(false)
    expect(convexMocks.mutationFn).toHaveBeenCalledWith({
      chatId: "chat-server",
      title: "Late Title",
      generation: 1,
    })
  })

  it("preserves a guest rename when a generated title arrives late", async () => {
    persistMocks.tables.chats.set(
      "local-existing",
      localChat({
        title: "New chat",
        title_source: "provisional",
        title_generation: 1,
      })
    )
    const capture: { current: ReturnType<typeof useChats> | null } = {
      current: null,
    }

    renderProvider(capture)
    await flushPromises()

    let applied: boolean | undefined
    await act(async () => {
      await capture.current?.updateTitle("local-existing", "My custom title")
      applied = await capture.current?.applyGeneratedTitle(
        "local-existing",
        "Late generated title",
        1
      )
    })

    expect(applied).toBe(false)
    expect(persistMocks.tables.chats.get("local-existing")).toMatchObject({
      title: "My custom title",
      title_source: "user",
      title_generation: 1,
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
        model: "gpt-5-mini",
        systemPrompt: "system",
        message: { clientMessageId: "optimistic-1", text: "Question" },
        attachmentIds: [],
      })
    })

    expect(convexMocks.mutationFn).toHaveBeenCalledWith({
      title: "New chat",
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
        message: { clientMessageId: "optimistic-1", text: "Guest question" },
        attachmentIds: [],
      })
    })

    expect(created).toMatchObject({
      kind: "local",
      chat: {
        id: expect.stringMatching(/^local-/),
        user_id: "guest_1",
        title: "New chat",
        title_source: "provisional",
        title_generation: 1,
        model: "gpt-5-mini",
      },
    })
    expect(convexMocks.mutationFn).not.toHaveBeenCalled()
    expect(persistMocks.writeToIndexedDB).toHaveBeenCalledWith(
      "chats",
      expect.objectContaining({ user_id: "guest_1" })
    )
    if (!created || created.kind !== "local")
      throw new Error("Expected local chat")
    const localChatId = created.chat.id

    await act(async () => {
      await expect(
        capture.current?.applyGeneratedTitle(localChatId, "Stale title", 2)
      ).resolves.toBe(false)
      await expect(
        capture.current?.applyGeneratedTitle(
          localChatId,
          "Guest Conversation",
          1
        )
      ).resolves.toBe(true)
    })
    expect(persistMocks.tables.chats.get(localChatId)).toMatchObject({
      title: "Guest Conversation",
      title_source: "generated",
    })

    await act(async () => {
      await capture.current?.updateTitle(localChatId, "My custom title")
      await expect(
        capture.current?.applyGeneratedTitle(localChatId, "Late title", 1)
      ).resolves.toBe(false)
    })
    expect(persistMocks.tables.chats.get(localChatId)).toMatchObject({
      title: "My custom title",
      title_source: "user",
    })
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
