/** @vitest-environment jsdom */

import type { UIMessage } from "@ai-sdk/react"
import React, { act, useLayoutEffect, useState } from "react"
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
import {
  useCommitDetachableChatStream,
  useDetachableChatStream,
  type ChatStreamFinishEvent,
} from "./use-detachable-chat-stream"

const lifecycleMocks = vi.hoisted(() => ({
  bindings: [] as Array<{
    options: {
      onFinish: (event: ChatStreamFinishEvent) => void
      onError: (error: Error) => void
      sendAutomaticallyWhen: (args: { messages: UIMessage[] }) => boolean
    }
    stop: ReturnType<typeof vi.fn>
  }>,
  approvalGate: vi.fn(() => true),
}))

vi.mock("@ai-sdk/react", () => ({
  Chat: class MockChat {
    readonly stop = vi.fn()

    constructor(
      readonly options: {
        onFinish: (event: ChatStreamFinishEvent) => void
        onError: (error: Error) => void
        sendAutomaticallyWhen: (args: { messages: UIMessage[] }) => boolean
      }
    ) {
      lifecycleMocks.bindings.push(this)
    }
  },
}))

vi.mock("ai", () => ({
  DefaultChatTransport: class MockDefaultChatTransport {},
  lastAssistantMessageIsCompleteWithApprovalResponses:
    lifecycleMocks.approvalGate,
}))

const finishEvent = {
  message: {
    id: "assistant-1",
    role: "assistant",
    parts: [{ type: "text", text: "done" }],
  },
  isAbort: false,
  isDisconnect: false,
  isError: false,
} as ChatStreamFinishEvent

describe("detachable chat stream lifecycle", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeAll(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  beforeEach(() => {
    vi.clearAllMocks()
    lifecycleMocks.bindings.length = 0
  })

  afterEach(() => {
    if (root) act(() => root?.unmount())
    container?.remove()
    container = null
    root = null
    vi.useRealTimers()
  })

  function mountHarness(initialChatId: string | null) {
    const events: Array<{
      route:
        | "attached-finish"
        | "detached-finish"
        | "attached-error"
        | "detached-error"
      visibleChatId: string | null
      originChatId?: string | null
    }> = []
    let setChatId: ((chatId: string | null) => void) | null = null
    let fireAtBoundary = false
    let boundaryTimerCount = -1

    function Harness() {
      const [chatId, setChatIdState] = useState(initialChatId)
      const stream = useDetachableChatStream({
        chatId,
        initialMessages: [],
        streamTimeoutMs: 120_000,
        api: "/api/chat",
      })
      useCommitDetachableChatStream({
        stream,
        chatId,
        initialMessages: [],
        handlers: {
          onAttachedFinish: () => {
            events.push({ route: "attached-finish", visibleChatId: chatId })
          },
          onDetachedFinish: (originChatId) => {
            events.push({
              route: "detached-finish",
              visibleChatId: chatId,
              originChatId,
            })
          },
          onAttachedError: () => {
            events.push({ route: "attached-error", visibleChatId: chatId })
          },
          onDetachedError: (originChatId) => {
            events.push({
              route: "detached-error",
              visibleChatId: chatId,
              originChatId,
            })
          },
        },
        onChatTransition: () => undefined,
      })

      // Declared after the lifecycle's commit effect: this is the deterministic
      // navigation boundary. The old binding finishes/errors immediately after
      // detachment and new-handler publication in the same React commit.
      useLayoutEffect(() => {
        setChatId = setChatIdState
        if (!fireAtBoundary) return
        fireAtBoundary = false
        boundaryTimerCount = vi.getTimerCount()
        const originBinding = lifecycleMocks.bindings[0]
        originBinding?.options.onError(new Error("boundary error"))
        originBinding?.options.onFinish(finishEvent)
      }, [chatId])
      return null
    }

    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(<Harness />))

    return {
      events,
      setChatId(nextChatId: string | null, atBoundary = false) {
        fireAtBoundary = atBoundary
        act(() => setChatId?.(nextChatId))
      },
      boundaryTimerCount: () => boundaryTimerCount,
    }
  }

  it("keeps a pre-commit finish attached and does not arm a settled watchdog", () => {
    vi.useFakeTimers()
    const harness = mountHarness("chat-a")
    const originBinding = lifecycleMocks.bindings[0]
    if (!originBinding) throw new Error("origin binding was not created")

    // Before the transition commit, the old binding still uses chat A's
    // attached handler. Since that stream is already terminal, the subsequent
    // route transition has no orphaned work to watchdog.
    originBinding.options.onFinish(finishEvent)
    expect(harness.events).toEqual([
      { route: "attached-finish", visibleChatId: "chat-a" },
    ])

    harness.setChatId("chat-b")

    expect(vi.getTimerCount()).toBe(0)
    expect(originBinding.stop).not.toHaveBeenCalled()
  })

  it("routes finish and error atomically after the navigation commit", () => {
    vi.useFakeTimers()
    const harness = mountHarness("chat-a")
    const originBinding = lifecycleMocks.bindings[0]
    if (!originBinding) throw new Error("origin binding was not created")

    harness.setChatId("chat-b", true)

    expect(harness.boundaryTimerCount()).toBe(1)
    expect(harness.events).toEqual([
      {
        route: "detached-error",
        visibleChatId: "chat-b",
        originChatId: "chat-a",
      },
      {
        route: "detached-finish",
        visibleChatId: "chat-b",
        originChatId: "chat-a",
      },
    ])
    expect(originBinding.options.sendAutomaticallyWhen({ messages: [] })).toBe(
      false
    )
    // Finish clears the one detached watchdog; it cannot later stop twice.
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(120_000)
    expect(originBinding.stop).not.toHaveBeenCalled()
  })

  it("adopts null to chatId without detaching or replacing the first-turn binding", () => {
    vi.useFakeTimers()
    const harness = mountHarness(null)
    const firstTurnBinding = lifecycleMocks.bindings[0]
    if (!firstTurnBinding) throw new Error("first-turn binding was not created")

    harness.setChatId("chat-created")

    expect(lifecycleMocks.bindings).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
    expect(
      firstTurnBinding.options.sendAutomaticallyWhen({ messages: [] })
    ).toBe(true)
  })
})
