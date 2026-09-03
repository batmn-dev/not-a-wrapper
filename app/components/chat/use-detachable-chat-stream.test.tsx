/** @vitest-environment jsdom */

import { resetSharedChatStreamOwnersForTests } from "./use-detachable-chat-stream"
import type { UIMessage } from "@ai-sdk/react"
import {
  clearLocallyResolvedApprovals,
  markApprovalResolvedLocally,
} from "@/lib/chat-runs/approval-auto-send-gate"
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

beforeEach(() => {
  // The shared stream owner is process-lived; without a reset, one test's
  // live mock binding leaks into the next test's mount-time readopt.
  resetSharedChatStreamOwnersForTests()
})

const lifecycleMocks = vi.hoisted(() => ({
  bindings: [] as Array<{
    options: {
      onFinish: (event: ChatStreamFinishEvent) => void
      onError: (error: Error) => void
      sendAutomaticallyWhen: (args: { messages: UIMessage[] }) => boolean
    }
    status: string
    stop: ReturnType<typeof vi.fn>
  }>,
  approvalGate: vi.fn(() => true),
  markChatPerf: vi.fn(),
}))

vi.mock("@ai-sdk/react", () => ({
  Chat: class MockChat {
    status = "ready"
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

vi.mock("@/lib/observability/chat-performance", async () => {
  const actual =
    await vi.importActual<
      typeof import("@/lib/observability/chat-performance")
    >("@/lib/observability/chat-performance")
  return {
    ...actual,
    markChatPerf: lifecycleMocks.markChatPerf,
  }
})

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
    clearLocallyResolvedApprovals()
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
        isAuthenticated: false,
        initialMessages: [],
        streamTimeoutMs: 120_000,
        api: "/api/chat",
      })
      useCommitDetachableChatStream({
        stream,
        chatId,
        initialMessages: [],
        handlers: {
          onData: () => {},
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

  it("settles a normally finished attached gauge exactly once", () => {
    const harness = mountHarness("chat-a")
    const originBinding = lifecycleMocks.bindings[0]
    if (!originBinding) throw new Error("origin binding was not created")

    const createdGauge = lifecycleMocks.markChatPerf.mock.calls.find(
      ([name, fields]) =>
        name === "detached_binding_gauge" && fields.event === "created"
    )?.[1]
    if (!createdGauge) throw new Error("created gauge was not emitted")

    originBinding.options.onFinish(finishEvent)

    const finishedGauge = lifecycleMocks.markChatPerf.mock.calls.find(
      ([name, fields]) =>
        name === "detached_binding_gauge" &&
        fields.event === "finished_attached"
    )?.[1]
    expect(finishedGauge).toMatchObject({
      attachedCount: createdGauge.attachedCount - 1,
      detachedCount: createdGauge.detachedCount,
    })

    harness.setChatId("chat-b")

    const detachedGauge = lifecycleMocks.markChatPerf.mock.calls.find(
      ([name, fields]) =>
        name === "detached_binding_gauge" && fields.event === "detached"
    )?.[1]
    expect(detachedGauge).toMatchObject({
      attachedCount: createdGauge.attachedCount - 1,
      detachedCount: createdGauge.detachedCount,
    })
  })

  it("routes finish and error atomically after the navigation commit", () => {
    vi.useFakeTimers()
    const harness = mountHarness("chat-a")
    const originBinding = lifecycleMocks.bindings[0]
    if (!originBinding) throw new Error("origin binding was not created")
    originBinding.status = "streaming"

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

  it("watchdogs and counts a later-turn stream after finished has latched", () => {
    vi.useFakeTimers()
    const harness = mountHarness("chat-a")
    const originBinding = lifecycleMocks.bindings[0]
    if (!originBinding) throw new Error("origin binding was not created")

    // The first turn settles the attached gauge and latches `finished`.
    originBinding.options.onFinish(finishEvent)
    const firstFinishGauge = lifecycleMocks.markChatPerf.mock.calls.find(
      ([name, fields]) =>
        name === "detached_binding_gauge" &&
        fields.event === "finished_attached"
    )?.[1]
    if (!firstFinishGauge) throw new Error("first finish gauge was not emitted")

    // The same SDK Chat starts a later turn. Current liveness, rather than the
    // first-turn latch, must transfer it into detached ownership.
    originBinding.status = "streaming"
    harness.setChatId("chat-b")

    const detachedGauge = lifecycleMocks.markChatPerf.mock.calls.find(
      ([name, fields]) =>
        name === "detached_binding_gauge" && fields.event === "detached"
    )?.[1]
    expect(detachedGauge).toMatchObject({
      attachedCount: firstFinishGauge.attachedCount,
      detachedCount: firstFinishGauge.detachedCount + 1,
    })
    expect(vi.getTimerCount()).toBe(1)

    originBinding.status = "ready"
    originBinding.options.onFinish(finishEvent)

    const detachedFinishGauge = lifecycleMocks.markChatPerf.mock.calls.find(
      ([name, fields]) =>
        name === "detached_binding_gauge" &&
        fields.event === "finished_detached"
    )?.[1]
    expect(detachedFinishGauge).toMatchObject({
      detachedCount: firstFinishGauge.detachedCount,
    })
    expect(vi.getTimerCount()).toBe(0)
  })

  it("adopts null to chatId without detaching or replacing the first-turn binding", () => {
    vi.useFakeTimers()
    const harness = mountHarness(null)
    const firstTurnBinding = lifecycleMocks.bindings[0]
    if (!firstTurnBinding) throw new Error("first-turn binding was not created")

    harness.setChatId("chat-created")

    expect(lifecycleMocks.bindings).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
    // Attached AND locally resolved → auto-send arms; an adopted approval
    // part alone never does.
    const approvalMessage = {
      id: "assistant-1",
      role: "assistant",
      parts: [
        {
          type: "tool-send_email",
          state: "approval-responded",
          approval: { id: "approval_local", approved: true },
        },
      ],
    } as unknown as UIMessage
    expect(
      firstTurnBinding.options.sendAutomaticallyWhen({
        messages: [approvalMessage],
      })
    ).toBe(false)
    markApprovalResolvedLocally("approval_local")
    expect(
      firstTurnBinding.options.sendAutomaticallyWhen({
        messages: [approvalMessage],
      })
    ).toBe(true)
    // One-shot arm: the resolution authorized exactly one dispatch. A remount
    // that rehydrates the same approval-responded part (still present until
    // the continuation lands) must find the gate closed — reload never
    // submits another model request.
    expect(
      firstTurnBinding.options.sendAutomaticallyWhen({
        messages: [approvalMessage],
      })
    ).toBe(false)

    // ...but an ERRORED armed dispatch restores the authorization: the SDK
    // never re-evaluates its predicate on error and the approval is already
    // resolved durably, so without restoration the continuation would be
    // stranded with no recovery path. A finished dispatch stays consumed.
    firstTurnBinding.options.onError(new Error("continuation transport died"))
    expect(
      firstTurnBinding.options.sendAutomaticallyWhen({
        messages: [approvalMessage],
      })
    ).toBe(true)
    firstTurnBinding.options.onFinish(finishEvent)
    firstTurnBinding.options.onError(new Error("later unrelated error"))
    expect(
      firstTurnBinding.options.sendAutomaticallyWhen({
        messages: [approvalMessage],
      })
    ).toBe(false)
  })
})
