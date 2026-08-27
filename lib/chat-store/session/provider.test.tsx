/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { ChatSessionProvider, useChatSession } from "./provider"

const navigationMocks = vi.hoisted(() => ({ pathname: "/" }))

vi.mock("next/navigation", () => ({
  usePathname: () => navigationMocks.pathname,
}))

function SessionProbe() {
  const { chatId, isNewChatSurface, isChatIdHandoff, navigateToChat } =
    useChatSession()

  return (
    <button
      type="button"
      data-new-chat={String(isNewChatSurface)}
      data-chat-id-handoff={String(isChatIdHandoff)}
      onClick={() => navigateToChat("chat-durable")}
    >
      {chatId ?? "new-chat"}
    </button>
  )
}

describe("ChatSessionProvider route identity", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeAll(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    if (root) act(() => root?.unmount())
    container?.remove()
    window.history.replaceState(null, "", "/")
    navigationMocks.pathname = "/"
    container = null
    root = null
  })

  function renderSession() {
    if (!container) {
      container = document.createElement("div")
      document.body.appendChild(container)
      root = createRoot(container)
    }

    act(() => {
      root?.render(
        <ChatSessionProvider>
          <SessionProbe />
        </ChatSessionProvider>
      )
    })
  }

  it("owns the shallow new-chat to durable-chat handoff", () => {
    renderSession()
    expect(container?.textContent).toBe("new-chat")
    expect(container?.querySelector("button")?.dataset.newChat).toBe("true")
    expect(container?.querySelector("button")?.dataset.chatIdHandoff).toBe(
      "false"
    )

    act(() => {
      container?.querySelector("button")?.click()
    })

    expect(window.location.pathname).toBe("/c/chat-durable")
    // Next's pathname transition has not committed yet, but session identity
    // already crossed the handoff with no blank selected-chat interval.
    expect(container?.textContent).toBe("chat-durable")
    expect(container?.querySelector("button")?.dataset.newChat).toBe("false")
    expect(container?.querySelector("button")?.dataset.chatIdHandoff).toBe(
      "true"
    )

    navigationMocks.pathname = "/c/chat-durable"
    renderSession()

    expect(container?.textContent).toBe("chat-durable")
    expect(container?.querySelector("button")?.dataset.chatIdHandoff).toBe(
      "false"
    )
  })

  it("drops a pending handoff if navigation returns to its source", () => {
    renderSession()

    act(() => {
      container?.querySelector("button")?.click()
    })
    expect(container?.textContent).toBe("chat-durable")

    window.history.replaceState(null, "", "/")
    renderSession()

    expect(container?.textContent).toBe("new-chat")
    expect(container?.querySelector("button")?.dataset.newChat).toBe("true")
  })
})
