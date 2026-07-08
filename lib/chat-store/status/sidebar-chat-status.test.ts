/** @vitest-environment jsdom */

import { JSDOM } from "jsdom"
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

type SidebarStatusModule = typeof import("./sidebar-chat-status")

const convexMocks = {
  isAuthenticated: true,
  markChatRead: vi.fn(async () => {}),
}

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({
    isAuthenticated: convexMocks.isAuthenticated,
    isLoading: false,
  }),
  useMutation: () => convexMocks.markChatRead,
}))

let deriveChatRowStatus: SidebarStatusModule["deriveChatRowStatus"]
let useMarkChatReadOnView: SidebarStatusModule["useMarkChatReadOnView"]
let dom: JSDOM | null = null

beforeAll(async () => {
  dom = new JSDOM("<!doctype html><html><body></body></html>")
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  })

  const module = await import("./sidebar-chat-status")
  deriveChatRowStatus = module.deriveChatRowStatus
  useMarkChatReadOnView = module.useMarkChatReadOnView
})

afterAll(() => {
  dom?.window.close()
  dom = null
})

function flushEffects() {
  return act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function MarkReadHarness({
  chatId,
  lastRunEndedAt,
}: {
  chatId: string | null
  lastRunEndedAt?: number | null
}) {
  useMarkChatReadOnView(chatId, lastRunEndedAt)
  return null
}

describe("deriveChatRowStatus", () => {
  it("maps the chat doc's live_run_status through when there is no override", () => {
    expect(deriveChatRowStatus({ live_run_status: "streaming" }, null)).toBe(
      "streaming"
    )
    expect(deriveChatRowStatus({ live_run_status: "awaiting" }, null)).toBe(
      "awaiting"
    )
  })

  it("returns idle for a chat with no projection fields (guest/local/optimistic)", () => {
    expect(deriveChatRowStatus({}, null)).toBe("idle")
  })

  it("lets a non-idle override win over the backend (local error beats projected streaming)", () => {
    // Terminal failure writes are best-effort and can lag, so the tab that
    // errored is authoritative for its own row.
    expect(deriveChatRowStatus({ live_run_status: "streaming" }, "error")).toBe(
      "error"
    )
  })

  it("does not let an idle override lower the backend (re-entered background run keeps spinning)", () => {
    // Nav remounts Chat without resuming the stream, so the active tab reads
    // `ready` → idle override; the projected spinner must survive.
    expect(deriveChatRowStatus({ live_run_status: "streaming" }, "idle")).toBe(
      "streaming"
    )
  })

  it("derives unread when a completed run finished after the read cursor", () => {
    expect(
      deriveChatRowStatus(
        {
          last_run_ended_at: 200,
          last_run_status: "completed",
          last_read_at: 100,
        },
        null
      )
    ).toBe("unread")
  })

  it("derives error when a failed run finished after the read cursor", () => {
    expect(
      deriveChatRowStatus(
        {
          last_run_ended_at: 200,
          last_run_status: "failed",
          last_read_at: 100,
        },
        null
      )
    ).toBe("error")
  })

  it("derives idle once the read cursor has caught up (seen)", () => {
    expect(
      deriveChatRowStatus(
        {
          last_run_ended_at: 200,
          last_run_status: "completed",
          last_read_at: 200,
        },
        null
      )
    ).toBe("idle")
  })

  it("derives idle for an aborted run (no mirror written)", () => {
    // aborted/superseded only clear liveRunStatus; no lastRunEndedAt/Status →
    // never a dot.
    expect(deriveChatRowStatus({ last_read_at: 100 }, null)).toBe("idle")
  })

  it("lets live status beat an unseen completion", () => {
    // A new turn started (live streaming) after a prior unseen completion: the
    // live phase wins over the stale unread mirror.
    expect(
      deriveChatRowStatus(
        {
          live_run_status: "streaming",
          last_run_ended_at: 200,
          last_run_status: "completed",
          last_read_at: 100,
        },
        null
      )
    ).toBe("streaming")
  })
})

describe("useMarkChatReadOnView", () => {
  const convexChatId = "abcdefghijklmnopqrstuvwxyz"
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    convexMocks.isAuthenticated = true
    convexMocks.markChatRead.mockClear()
    convexMocks.markChatRead.mockResolvedValue(undefined)
  })

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
    }
    container?.remove()
    root = null
    container = null
  })

  it("skips open-time writes until a terminal mirror exists", async () => {
    act(() => {
      root?.render(
        React.createElement(MarkReadHarness, {
          chatId: convexChatId,
          lastRunEndedAt: null,
        })
      )
    })
    await flushEffects()

    expect(convexMocks.markChatRead).not.toHaveBeenCalled()
  })

  it("passes the observed terminal mirror as the read-through timestamp", async () => {
    act(() => {
      root?.render(
        React.createElement(MarkReadHarness, {
          chatId: convexChatId,
          lastRunEndedAt: 200,
        })
      )
    })
    await flushEffects()

    expect(convexMocks.markChatRead).toHaveBeenCalledWith({
      chatId: convexChatId,
      readThroughAt: 200,
    })
  })

  it("marks again when the active chat's terminal mirror advances", async () => {
    act(() => {
      root?.render(
        React.createElement(MarkReadHarness, {
          chatId: convexChatId,
          lastRunEndedAt: 200,
        })
      )
    })
    await flushEffects()

    act(() => {
      root?.render(
        React.createElement(MarkReadHarness, {
          chatId: convexChatId,
          lastRunEndedAt: 300,
        })
      )
    })
    await flushEffects()

    expect(convexMocks.markChatRead).toHaveBeenCalledTimes(2)
    expect(convexMocks.markChatRead).toHaveBeenLastCalledWith({
      chatId: convexChatId,
      readThroughAt: 300,
    })
  })
})
