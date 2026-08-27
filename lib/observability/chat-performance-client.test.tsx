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
import {
  beginChatPerfTurn,
  deriveChatPerfTurnFacts,
  noteChatPerfStopIntent,
  useChatNavigationPerfMarks,
  useChatTurnPerfMarks,
} from "./chat-performance-client"

type NavigationPerfInput = Parameters<typeof useChatNavigationPerfMarks>[0]

function NavigationPerfHarness(input: NavigationPerfInput) {
  useChatNavigationPerfMarks(input)
  return null
}

type TurnPerfInput = Parameters<typeof useChatTurnPerfMarks>[0]

function TurnPerfHarness(input: TurnPerfInput) {
  useChatTurnPerfMarks(input)
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

describe("chat turn performance marks", () => {
  let container: HTMLDivElement
  let root: Root
  let markSpy: MockInstance<typeof performance.mark>

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

  function render(input: Partial<TurnPerfInput>) {
    act(() => {
      root.render(
        <TurnPerfHarness
          status="ready"
          hasVisibleAssistantText={false}
          visibleAssistantTextLength={0}
          lastUserMessageId={undefined}
          {...input}
        />
      )
    })
  }

  function marksNamed(name: string) {
    return markSpy.mock.calls.filter(([mark]) => mark === `chat-perf:${name}`)
  }

  it("emits first_chunk_received once per turn, not on reconciliation re-renders", () => {
    render({ status: "ready" })
    render({ status: "submitted" })
    render({ status: "streaming" })
    // Same-status re-renders (message reconciliation) must not re-fire.
    render({ status: "streaming" })
    render({ status: "streaming", lastUserMessageId: "u1" })

    expect(marksNamed("first_chunk_received")).toHaveLength(1)
  })

  it("emits first_visible_text once with the bucketed length, resetting on a new turn", () => {
    render({ status: "submitted" })
    render({ status: "streaming" })
    expect(marksNamed("first_visible_text")).toHaveLength(0)

    render({
      status: "streaming",
      hasVisibleAssistantText: true,
      visibleAssistantTextLength: 100,
    })
    // Growth must not re-fire the mark.
    render({
      status: "streaming",
      hasVisibleAssistantText: true,
      visibleAssistantTextLength: 5000,
    })
    expect(marksNamed("first_visible_text")).toEqual([
      ["chat-perf:first_visible_text", { detail: { textLengthBucket: 128 } }],
    ])

    // A new turn re-arms the mark.
    render({ status: "ready" })
    render({ status: "submitted" })
    render({
      status: "streaming",
      hasVisibleAssistantText: true,
      visibleAssistantTextLength: 3,
    })
    expect(marksNamed("first_visible_text")).toHaveLength(2)
    expect(marksNamed("first_visible_text")[1]?.[1]).toEqual({
      detail: { textLengthBucket: 4 },
    })
  })

  it("reports abort on stream_terminal after a stop intent, and finish otherwise", () => {
    beginChatPerfTurn()
    render({ status: "submitted" })
    render({ status: "streaming" })
    noteChatPerfStopIntent()
    render({ status: "ready" })
    expect(marksNamed("stop_intent")).toHaveLength(1)
    expect(marksNamed("stream_terminal").at(-1)?.[1]).toMatchObject({
      detail: expect.objectContaining({ outcome: "abort" }),
    })

    // A new turn clears the noted stop; a natural completion reads finish.
    beginChatPerfTurn()
    render({ status: "submitted" })
    render({ status: "streaming" })
    render({ status: "ready" })
    expect(marksNamed("stream_terminal").at(-1)?.[1]).toMatchObject({
      detail: expect.objectContaining({ outcome: "finish" }),
    })
  })

  it("is a no-op when instrumentation is disabled", () => {
    delete process.env.NEXT_PUBLIC_CHAT_PERF_INSTRUMENTATION
    render({ status: "submitted" })
    render({ status: "streaming" })
    render({
      status: "streaming",
      hasVisibleAssistantText: true,
      visibleAssistantTextLength: 10,
    })
    expect(markSpy).not.toHaveBeenCalled()
  })
})

describe("deriveChatPerfTurnFacts", () => {
  it("ignores a prior turn's settled assistant text (current-turn boundary)", () => {
    const facts = deriveChatPerfTurnFacts([
      { id: "u1", role: "user", parts: [{ type: "text", text: "q1" }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "old answer" }] },
      { id: "u2", role: "user", parts: [{ type: "text", text: "q2" }] },
    ])
    expect(facts).toEqual({
      hasVisibleAssistantText: false,
      visibleAssistantTextLength: 0,
      lastUserMessageId: "u2",
    })
  })

  it("counts only the live turn's visible text parts", () => {
    const facts = deriveChatPerfTurnFacts([
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "old" }] },
      { id: "u2", role: "user", parts: [] },
      {
        id: "a2",
        role: "assistant",
        parts: [
          { type: "reasoning", text: "hidden" },
          { type: "text", text: "12345" },
          { type: "text", text: "678" },
        ],
      },
    ])
    expect(facts.hasVisibleAssistantText).toBe(true)
    expect(facts.visibleAssistantTextLength).toBe(8)
    expect(facts.lastUserMessageId).toBe("u2")
  })
})
