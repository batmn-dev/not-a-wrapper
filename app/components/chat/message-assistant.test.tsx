/** @vitest-environment jsdom */
import type { UIMessage } from "@ai-sdk/react"
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { MessageAssistant } from "./message-assistant"

vi.mock("@/lib/user-preference-store/provider", () => ({
  useUserPreferences: () => ({
    preferences: {
      showToolInvocations: false,
    },
  }),
}))

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true
})

describe("MessageAssistant activity trigger", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    const rootToUnmount = root
    if (rootToUnmount) {
      act(() => {
        rootToUnmount.unmount()
      })
    }
    container?.remove()
    root = null
    container = null
  })

  it("keeps the activity trigger for completed opaque reasoning", () => {
    const onOpenActivityPanel = vi.fn()
    const parts = [
      { type: "reasoning", text: "", state: "done" },
    ] as unknown as UIMessage["parts"]

    act(() => {
      root?.render(
        <MessageAssistant
          messageId="assistant-1"
          activeTurnId="assistant-1"
          onOpenActivityPanel={onOpenActivityPanel}
          parts={parts}
          metadata={{ reasoningDurationMs: 2000 }}
          status="ready"
        >
          {""}
        </MessageAssistant>
      )
    })

    const trigger = container?.querySelector(
      'button[aria-label="Open activity: Thought for 2s"]'
    ) as HTMLButtonElement | null

    expect(trigger).toBeTruthy()

    act(() => {
      trigger?.click()
    })

    expect(onOpenActivityPanel).toHaveBeenCalledTimes(1)
  })
})
