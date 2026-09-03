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
  const {
    chatId,
    isNewChatSurface,
    isChatIdHandoff,
    commitChatIdentity,
    resetChatIdentity,
  } = useChatSession()

  return (
    <div>
      <button
        type="button"
        data-testid="commit"
        data-new-chat={String(isNewChatSurface)}
        data-chat-id-handoff={String(isChatIdHandoff)}
        onClick={() => commitChatIdentity("chat-minted")}
      >
        {chatId ?? "new-chat"}
      </button>
      <button type="button" data-testid="reset" onClick={resetChatIdentity} />
    </div>
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

  const probe = () => container!.querySelector<HTMLButtonElement>("[data-testid=commit]")!
  const click = (testId: string) =>
    act(() => {
      container?.querySelector<HTMLButtonElement>(`[data-testid=${testId}]`)?.click()
    })

  it("commits the route synchronously when the identity is set", () => {
    renderSession()
    expect(probe().textContent).toBe("new-chat")
    expect(probe().dataset.newChat).toBe("true")

    const historyLength = window.history.length
    click("commit")

    // The route is a derived view of session state: pushed before Next has
    // observed the pathname, with no blank selected-chat interval.
    expect(window.location.pathname).toBe("/c/chat-minted")
    expect(window.history.length).toBe(historyLength + 1)
    expect(probe().textContent).toBe("chat-minted")
    expect(probe().dataset.newChat).toBe("false")
    expect(probe().dataset.chatIdHandoff).toBe("true")

    navigationMocks.pathname = "/c/chat-minted"
    renderSession()

    expect(probe().textContent).toBe("chat-minted")
    expect(probe().dataset.chatIdHandoff).toBe("false")
  })

  it("restores the origin route in place on rollback and clears the handoff", () => {
    window.history.replaceState(null, "", "/p/project-1")
    navigationMocks.pathname = "/p/project-1"
    renderSession()

    click("commit")
    expect(window.location.pathname).toBe("/c/chat-minted")
    const historyLength = window.history.length

    click("reset")

    // replaceState, not a second push: the refused turn leaves no orphan entry.
    expect(window.location.pathname).toBe("/p/project-1")
    expect(window.history.length).toBe(historyLength)
    expect(probe().textContent).toBe("new-chat")
    expect(probe().dataset.chatIdHandoff).toBe("false")
  })

  it("drops a pending handoff if navigation returns to its source", () => {
    renderSession()

    click("commit")
    expect(probe().textContent).toBe("chat-minted")

    window.history.replaceState(null, "", "/")
    renderSession()

    expect(probe().textContent).toBe("new-chat")
    expect(probe().dataset.newChat).toBe("true")
  })
})
