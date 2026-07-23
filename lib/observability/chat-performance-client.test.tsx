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
  type MockInstance,
} from "vitest"
import { useChatNavigationPerfMarks } from "./chat-performance-client"

type NavigationPerfInput = Parameters<typeof useChatNavigationPerfMarks>[0]

function NavigationPerfHarness(input: NavigationPerfInput) {
  useChatNavigationPerfMarks(input)
  return null
}

describe("chat navigation performance marks", () => {
  let container: HTMLDivElement
  let root: Root
  let markSpy: MockInstance<typeof performance.mark>

  beforeAll(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  beforeEach(() => {
    process.env.NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION = "true"
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    markSpy = vi.spyOn(performance, "mark")
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    delete process.env.NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION
    vi.restoreAllMocks()
  })

  function render(chatId: string, selectedRunStatus: string | null) {
    act(() => {
      root.render(
        <NavigationPerfHarness
          chatId={chatId}
          isAuthoritativeLoading={false}
          authoritativeMessageCount={0}
          totalMessageCount={0}
          selectedRunStatus={selectedRunStatus}
        />
      )
    })
  }

  function settlementMarks() {
    return markSpy.mock.calls.filter(
      ([name]) => name === "chat-perf:durable_settlement_receipt"
    )
  }

  it("marks a terminal transition observed within one chat", () => {
    render("chat-a", "running")
    markSpy.mockClear()

    render("chat-a", "completed")

    expect(settlementMarks()).toEqual([
      [
        "chat-perf:durable_settlement_receipt",
        { detail: { outcome: "completed" } },
      ],
    ])
  })

  it("does not mark an already-terminal status when switching chats", () => {
    render("chat-a", "running")
    markSpy.mockClear()

    render("chat-b", "completed")

    expect(settlementMarks()).toHaveLength(0)
  })

  it("preserves the destination baseline when both chats have the same status", () => {
    render("chat-a", "running")
    render("chat-b", "running")
    markSpy.mockClear()

    render("chat-b", "completed")

    expect(settlementMarks()).toHaveLength(1)
  })
})
