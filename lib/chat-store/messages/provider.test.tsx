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
import { resetCachedMessagesSnapshot } from "./api"
import { MessagesProvider, useMessages, useResetMessages } from "./provider"

const persistMocks = vi.hoisted(() => {
  const tables = {
    chats: new Map<string, unknown>(),
    messages: new Map<string, unknown>(),
    sync: new Map<string, unknown>(),
  }

  return {
    tables,
    readFromIndexedDB: vi.fn(
      async (table: keyof typeof tables, key?: string): Promise<unknown> => {
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
  }
})

const convexMocks = vi.hoisted(() => ({
  isAuthenticated: true,
  isAuthLoading: false,
  queryValue: undefined as unknown,
  mutationFn: vi.fn(),
  useQuery: vi.fn(),
}))

const sessionMocks = vi.hoisted(() => ({
  chatId: "local-thread" as string | null,
}))

// Persistence is derived from the server-seeded app user (ADR-0033): null is
// a guest reading IndexedDB; an id is a durable chat read through Convex.
const userMocks = vi.hoisted(() => ({
  user: null as { id: string } | null,
}))

vi.mock("@/lib/user-store/provider", () => ({
  useUser: () => ({ user: userMocks.user }),
}))

vi.mock("../persist", () => ({
  readFromIndexedDB: persistMocks.readFromIndexedDB,
  writeToIndexedDB: persistMocks.writeToIndexedDB,
}))

vi.mock("convex/react", () => ({
  // usePerUserQuery (the Per-user subscription seam) reads useConvexAuth to gate
  // the subscription before exposing query loading/data to provider call sites.
  useConvexAuth: () => ({
    isAuthenticated: convexMocks.isAuthenticated,
    isLoading: convexMocks.isAuthLoading,
  }),
  useMutation: () => convexMocks.mutationFn,
}))
// The seam's useQuery is the convex-helpers cached variant (ADR-0031).
vi.mock("convex-helpers/react/cache", () => ({
  useQuery: (...args: unknown[]) => {
    convexMocks.useQuery(...args)
    return convexMocks.queryValue
  },
}))

vi.mock("../session/provider", () => ({
  useChatSession: () => ({ chatId: sessionMocks.chatId }),
}))

vi.mock("@/components/ui/toast", () => ({
  toast: vi.fn(),
}))

function flushPromises() {
  return act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function MessagesSnapshot({
  captureRef,
}: {
  captureRef: { current: ReturnType<typeof useMessages> | null }
}) {
  const context = useMessages()
  React.useEffect(() => {
    captureRef.current = context
  }, [captureRef, context])

  return (
    <div
      data-loading={String(context.isLoading)}
      data-messages={context.messages.map((message) => message.id).join(",")}
    />
  )
}

describe("MessagesProvider local chat hydration", () => {
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
    convexMocks.isAuthenticated = true
    convexMocks.isAuthLoading = false
    convexMocks.queryValue = undefined
    convexMocks.mutationFn.mockReset()
    convexMocks.useQuery.mockClear()
    sessionMocks.chatId = "local-thread"
    userMocks.user = null
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
    current: ReturnType<typeof useMessages> | null
  }) {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <MessagesProvider>
          <MessagesSnapshot captureRef={captureRef} />
        </MessagesProvider>
      )
    })
  }

  it("hydrates local messages by active local chat id without querying Convex", async () => {
    persistMocks.tables.messages.set("local-thread", {
      id: "local-thread",
      messages: [
        {
          id: "user-1",
          role: "user",
          createdAt: new Date("2026-01-01T00:00:01.000Z"),
          parts: [{ type: "text", text: "reply exactly ok" }],
        },
        {
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "text", text: "ok" }],
        },
      ],
    })
    const capture: { current: ReturnType<typeof useMessages> | null } = {
      current: null,
    }

    renderProvider(capture)
    expect(capture.current?.isLoading).toBe(true)
    await flushPromises()

    expect(capture.current?.isLoading).toBe(false)
    expect(capture.current?.messages.map((message) => message.id)).toEqual([
      "user-1",
      "assistant-1",
    ])
    expect(capture.current?.messages[1]?.createdAt).toBeInstanceOf(Date)
    expect(convexMocks.useQuery).toHaveBeenCalledWith(expect.anything(), "skip")
  })

  it.each([false, true])("waits for a switched guest cache read, including empty history (%s)", async (hasHistory) => {
    const capture: { current: ReturnType<typeof useMessages> | null } = {
      current: null,
    }
    renderProvider(capture)
    await flushPromises()
    expect(capture.current?.isLoading).toBe(false)

    let resolveRead!: (value: unknown) => void
    persistMocks.readFromIndexedDB.mockImplementationOnce(
      () => new Promise((resolve) => { resolveRead = resolve })
    )
    sessionMocks.chatId = "second-chat"
    act(() => root?.render(
      <MessagesProvider><MessagesSnapshot captureRef={capture} /></MessagesProvider>
    ))
    expect(capture.current?.isLoading).toBe(true)
    expect(capture.current?.messages).toEqual([])
    await flushPromises()
    expect(capture.current?.isLoading).toBe(true)

    await act(async () => resolveRead({
      id: "second-chat",
      messages: hasHistory ? [{ id: "stored-message", role: "assistant", parts: [] }] : [],
    }))
    expect(capture.current?.isLoading).toBe(false)
    expect(capture.current?.messages.map((message) => message.id)).toEqual(
      hasHistory ? ["stored-message"] : []
    )
  })

  it("does not wait for IndexedDB on the new-chat route", () => {
    sessionMocks.chatId = null
    const capture: { current: ReturnType<typeof useMessages> | null } = {
      current: null,
    }
    renderProvider(capture)
    expect(capture.current?.isLoading).toBe(false)
    expect(persistMocks.readFromIndexedDB).not.toHaveBeenCalled()
  })

  it("does not keep a durable chat loading while the Convex auth gate is closed", async () => {
    userMocks.user = { id: "user-1" }
    convexMocks.isAuthenticated = false
    convexMocks.isAuthLoading = false
    sessionMocks.chatId = "server-thread"
    const capture: { current: ReturnType<typeof useMessages> | null } = {
      current: null,
    }

    renderProvider(capture)
    await flushPromises()

    expect(capture.current?.isLoading).toBe(false)
    expect(capture.current?.messages).toEqual([])
    expect(convexMocks.useQuery).toHaveBeenCalledWith(expect.anything(), "skip")
  })

  it("isolates reset consumers from message updates and resets only the current chat", async () => {
    const capture: { current: ReturnType<typeof useMessages> | null } = {
      current: null,
    }
    const commandRender = vi.fn()
    function ResetControl() {
      const reset = useResetMessages()
      commandRender()
      return <button onClick={() => void reset()}>Reset</button>
    }
    const children = (
      <>
        <MessagesSnapshot captureRef={capture} />
        <ResetControl />
      </>
    )
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    const render = () =>
      act(() => root?.render(<MessagesProvider>{children}</MessagesProvider>))
    render()
    await flushPromises()
    const initialRenders = commandRender.mock.calls.length
    act(() =>
      capture.current?.setMessages([
        { id: "first-chat-draft", role: "user", parts: [] },
      ])
    )
    expect(
      container.querySelector("[data-messages]")?.getAttribute("data-messages")
    ).toBe("first-chat-draft")
    expect(commandRender).toHaveBeenCalledTimes(initialRenders)

    sessionMocks.chatId = "second-chat"
    render()
    await flushPromises()
    const switchedRenders = commandRender.mock.calls.length
    act(() =>
      capture.current?.setMessages([
        { id: "second-chat-draft", role: "user", parts: [] },
      ])
    )
    expect(commandRender).toHaveBeenCalledTimes(switchedRenders)
    await act(async () => container?.querySelector("button")?.click())
    expect(capture.current?.messages).toEqual([])
    expect(commandRender).toHaveBeenCalledTimes(switchedRenders)

    sessionMocks.chatId = "local-thread"
    render()
    await flushPromises()
    expect(capture.current?.messages.map((message) => message.id)).toEqual([
      "first-chat-draft",
    ])
  })
})
