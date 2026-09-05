/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { ChatSessionProvider, useChatIdHandoff, useChatSession } from "./provider"

const navigationMocks = vi.hoisted(() => ({ pathname: "/" }))

vi.mock("next/navigation", () => ({
  usePathname: () => navigationMocks.pathname,
}))

function SessionProbe() {
  const {
    chatId,
    isNewChatSurface,
    commitChatIdentity,
    resetChatIdentity,
  } = useChatSession()
  const isChatIdHandoff = useChatIdHandoff()

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

  function renderSession(children: React.ReactNode = <SessionProbe />) {
    if (!container) {
      container = document.createElement("div")
      document.body.appendChild(container)
      root = createRoot(container)
    }

    act(() => {
      root?.render(
        <ChatSessionProvider>
          {children}
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

    // replaceState, not a second push: the pushed entry is rewritten to the
    // origin URL, so no entry names the abandoned chat.
    expect(window.location.pathname).toBe("/p/project-1")
    expect(window.history.length).toBe(historyLength)
    expect(probe().textContent).toBe("new-chat")
    expect(probe().dataset.chatIdHandoff).toBe("false")
  })

  it("does not broadcast handoff-only adoption to ordinary session consumers", () => {
    const sessions: Array<ReturnType<typeof useChatSession>> = []
    function OrdinarySessionConsumer() {
      sessions.push(useChatSession())
      return null
    }
    const children = (
      <>
        <SessionProbe />
        <OrdinarySessionConsumer />
      </>
    )
    renderSession(children)
    click("commit")
    expect(sessions.at(-1)?.chatId).toBe("chat-minted")
    expect(probe().dataset.chatIdHandoff).toBe("true")
    const afterCommit = sessions.length

    navigationMocks.pathname = "/c/chat-minted"
    renderSession(children)
    expect(probe().dataset.chatIdHandoff).toBe("false")
    expect(sessions).toHaveLength(afterCommit)

    click("reset")
    expect(sessions.at(-1)?.chatId).toBeNull()
    expect(sessions.length).toBeGreaterThan(afterCommit)
  })

  it("rolls back after Next observed the pushed pathname and masks its lag", () => {
    renderSession()
    click("commit")

    // Next caught up with the push: the handoff cleared, the pathname is the
    // pushed route. A refusal arriving now must still restore the origin.
    navigationMocks.pathname = "/c/chat-minted"
    renderSession()
    expect(probe().dataset.chatIdHandoff).toBe("false")

    click("reset")

    expect(window.location.pathname).toBe("/")
    // Next still reports the pushed pathname for a render; the session
    // already presents the origin so no consumer resolves the abandoned id.
    expect(probe().textContent).toBe("new-chat")
    expect(probe().dataset.newChat).toBe("true")

    navigationMocks.pathname = "/"
    renderSession()
    expect(probe().textContent).toBe("new-chat")
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
