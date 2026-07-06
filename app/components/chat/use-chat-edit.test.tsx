/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import type { ChatTurnController } from "@/lib/chat-turn/chat-turn-controller"
import { useChatEdit } from "./use-chat-edit"

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

describe("useChatEdit generation-active guard", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  afterEach(() => {
    const mounted = root
    if (mounted) act(() => mounted.unmount())
    container?.remove()
    container = null
    root = null
  })

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
        messages: [],
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

    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root?.render(<Harness />)
    })

    // Generation finishes after the closure was created.
    live.status = "ready"
    live.submitting = false

    const button = container.querySelector("button")
    await act(async () => {
      button?.click()
      await Promise.resolve()
    })

    expect(runEditTurn).toHaveBeenCalledTimes(1)
    expect(runEditTurn).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ready", isSubmitting: false })
    )
  })
})
