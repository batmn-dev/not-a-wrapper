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
import { MessagesProvider, useMessages } from "./provider"

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
  chatId: "local-thread",
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
    await flushPromises()

    expect(capture.current?.isLoading).toBe(false)
    expect(capture.current?.messages.map((message) => message.id)).toEqual([
      "user-1",
      "assistant-1",
    ])
    expect(capture.current?.messages[1]?.createdAt).toBeInstanceOf(Date)
    expect(convexMocks.useQuery).toHaveBeenCalledWith(expect.anything(), "skip")
  })

  it("does not keep an unauthenticated server chat loading after the auth gate settles", async () => {
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
})
