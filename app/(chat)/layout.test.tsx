/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import ChatLayout from "./layout"

vi.mock("@/app/components/layout/layout-app", () => ({
  LayoutApp: ({
    children,
    header,
  }: {
    children: React.ReactNode
    header?: React.ReactNode
  }) => (
    <nav aria-label="Chat history">
      {header}
      {children}
    </nav>
  ),
}))

vi.mock("@/app/components/chat/chat-chrome-host", () => ({
  ChatChromeProvider: ({ children }: { children: React.ReactNode }) => children,
  ChatChromeHeader: () => <div data-chat-chrome-header="" />,
}))

vi.mock("@/lib/chat-store/messages/provider", () => ({
  MessagesProvider: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock("@/app/components/chat/chat", () => ({
  Chat: () => <div data-chat-surface="" />,
}))

describe("chat route layout ownership", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeAll(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    container = null
    root = null
  })

  it("keeps the shell node and native offset while route content reconciles", () => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <ChatLayout>
          <div data-route="first" />
        </ChatLayout>
      )
    })
    const originalScrollRoot = container.querySelector<HTMLElement>(
      'nav[aria-label="Chat history"]'
    )
    expect(originalScrollRoot).not.toBeNull()
    if (originalScrollRoot) originalScrollRoot.scrollTop = 312

    act(() => {
      root?.render(
        <ChatLayout>
          <div data-route="second" />
        </ChatLayout>
      )
    })
    const settledScrollRoot = container.querySelector<HTMLElement>(
      'nav[aria-label="Chat history"]'
    )

    expect(settledScrollRoot).toBe(originalScrollRoot)
    expect(settledScrollRoot?.scrollTop).toBe(312)
    expect(container.querySelector("[data-chat-chrome-header]")).not.toBeNull()
    expect(container.querySelector("[data-route='first']")).toBeNull()
    expect(container.querySelector("[data-route='second']")).not.toBeNull()
  })

  it("owns the Chat surface so route-segment swaps cannot remount it", () => {
    // A page-owned Chat would remount and orphan the live stream on segment commit.
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <ChatLayout>
          <div data-route="first" />
        </ChatLayout>
      )
    })
    const surface = container.querySelector("[data-chat-surface]")
    expect(surface).not.toBeNull()

    act(() => {
      root?.render(
        <ChatLayout>
          <div data-route="second" />
        </ChatLayout>
      )
    })
    expect(container.querySelector("[data-chat-surface]")).toBe(surface)
  })
})
