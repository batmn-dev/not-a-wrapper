/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import type {
  ChatTurnController,
  ChatTurnMessage,
} from "@/lib/chat-turn/chat-turn-controller"
import { useChatEdit } from "./use-chat-edit"

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

describe("useChatEdit call-time reads", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  afterEach(() => {
    const mounted = root
    if (mounted) act(() => mounted.unmount())
    container?.remove()
    container = null
    root = null
  })

  function mount(harness: React.ReactElement) {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root?.render(harness)
    })
  }

  it("reads live status/isSubmitting at call time, not from a stale closure", async () => {
    const runEditTurn = vi.fn(async () => ({ ok: true as const }))
    const chatTurn = { runEditTurn } as unknown as ChatTurnController

    // Simulate a generation that is active at render time but idle by the time
    // the user actually saves the edit.
    const live = { status: "streaming", submitting: true }

    function Harness() {
      const { submitEdit } = useChatEdit({
        chatTurn,
        chatId: "chat-1",
        getMessages: () => [],
        getStatus: () => live.status,
        getIsSubmitting: () => live.submitting,
      })
      return (
        <button
          type="button"
          onClick={() => void submitEdit("message-1", "edited text")}
        >
          save
        </button>
      )
    }

    mount(<Harness />)

    // Generation finishes after the closure was created.
    live.status = "ready"
    live.submitting = false

    const button = container?.querySelector("button")
    await act(async () => {
      button?.click()
      await Promise.resolve()
    })

    expect(runEditTurn).toHaveBeenCalledTimes(1)
    expect(runEditTurn).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ready", isSubmitting: false })
    )
  })

  it("reads live messages at call time, so a stale closure dispatches the server-adopted createdAt", async () => {
    const runEditTurn = vi.fn(async () => ({ ok: true as const }))
    const chatTurn = { runEditTurn } as unknown as ChatTurnController

    // The same-session edit bug: the message row's memo comparator ignores
    // callback identity, so the row keeps a submitEdit closure from before the
    // selected-path projection adopted the server's write-time createdAt onto
    // the user message. The edit must still dispatch the ADOPTED array, or the
    // server cutoff guard rejects with "Edited message version changed".
    const preAdoption: ChatTurnMessage[] = [
      {
        id: "optimistic-1",
        role: "user",
        createdAt: new Date(1_000), // optimistic client clock
        parts: [{ type: "text", text: "hello" }],
      },
    ]
    const postAdoption: ChatTurnMessage[] = [
      { ...preAdoption[0]!, createdAt: new Date(2_000) }, // server write time
    ]
    const live = { messages: preAdoption }

    function Harness() {
      const { submitEdit } = useChatEdit({
        chatTurn,
        chatId: "chat-1",
        getMessages: () => live.messages,
        getStatus: () => "ready",
        getIsSubmitting: () => false,
      })
      return (
        <button
          type="button"
          onClick={() => void submitEdit("optimistic-1", "edited text")}
        >
          save
        </button>
      )
    }

    mount(<Harness />)

    // Projection adopts the server createdAt after the closure was created;
    // the memoized row never re-renders, so the closure is never refreshed.
    live.messages = postAdoption

    const button = container?.querySelector("button")
    await act(async () => {
      button?.click()
      await Promise.resolve()
    })

    expect(runEditTurn).toHaveBeenCalledTimes(1)
    expect(runEditTurn).toHaveBeenCalledWith(
      expect.objectContaining({ messages: postAdoption })
    )
  })
})
