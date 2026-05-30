/** @vitest-environment jsdom */

import type { Chats } from "@/lib/chat-store/types"
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { DesktopSearchModal } from "./desktop-search-modal"

const navigationMocks = vi.hoisted(() => ({
  push: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: navigationMocks.push,
  }),
}))

vi.mock("@/app/auth/actions", () => ({
  requestMagicAuthCode: vi.fn(),
}))

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

function makeChat(overrides: Partial<Chats> & Pick<Chats, "id" | "title">) {
  const baseChat: Chats = {
    id: "",
    user_id: "user-1",
    title: null,
    model: null,
    system_prompt: null,
    project_id: null,
    public: false,
    pinned: false,
    pinned_at: null,
    created_at: "2026-05-29T00:00:00.000Z",
    updated_at: "2026-05-29T00:00:00.000Z",
  }

  return {
    ...baseChat,
    ...overrides,
  } satisfies Chats
}

describe("DesktopSearchModal", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeAll(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true

    HTMLElement.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    const mountedRoot = root
    if (mountedRoot) {
      act(() => {
        mountedRoot.unmount()
      })
    }
    container?.remove()
    document.body.innerHTML = ""
    container = null
    root = null
    navigationMocks.push.mockReset()
  })

  function renderModal(chatHistory: Chats[]) {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <DesktopSearchModal
          chatHistory={chatHistory}
          currentChatId={null}
          isOpen
          onOpenChange={() => {}}
          isAuthenticated
        />
      )
    })
  }

  it("keeps project chats out of default browsing while preserving them in search", async () => {
    renderModal([
      makeChat({ id: "regular-chat", title: "Regular planning" }),
      makeChat({
        id: "project-chat",
        title: "Project roadmap",
        project_id: "project-1",
      }),
    ])

    expect(document.body.textContent).toContain("Regular planning")
    expect(document.body.textContent).not.toContain("Project roadmap")

    const input = document.body.querySelector(
      'input[aria-label="Search chats"]'
    ) as HTMLInputElement | null

    if (!input) {
      throw new Error("Search input was not mounted")
    }

    await act(async () => {
      const setInputValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set

      setInputValue?.call(input, "roadmap")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    expect(document.body.textContent).toContain("Project roadmap")
    expect(document.body.textContent).not.toContain("No chat history found.")
  })
})
