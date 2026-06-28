/** @vitest-environment jsdom */

import type { UIMessage } from "@ai-sdk/react"
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("@/components/ui/message", () => ({
  Message: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock("@/components/ui/scroll-root", () => ({
  ScrollRootContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

vi.mock("@/components/ui/thinking-bar", () => ({
  ThinkingBar: () => <div data-testid="thinking" />,
}))

vi.mock("./message", () => ({
  Message: ({
    id,
    activityPanelTurnId,
    onReload,
    status,
    children,
  }: {
    id: string
    activityPanelTurnId?: string
    onReload?: (messageId: string) => void
    status?: string
    children: React.ReactNode
  }) => (
    <button
      data-activity-panel-turn-id={activityPanelTurnId}
      data-can-reload={Boolean(onReload)}
      data-status={status}
      data-testid={`message-${id}`}
      onClick={() => onReload?.(id)}
      type="button"
    >
      {children}
    </button>
  ),
}))

import { Conversation } from "./conversation"
import { PENDING_ACTIVITY_TURN_ID } from "./use-activity-panel"

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true
})

describe("Conversation regeneration availability", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  function cleanupRender() {
    const mountedRoot = root
    if (mountedRoot) {
      act(() => mountedRoot.unmount())
    }
    container?.remove()
    root = null
    container = null
  }

  afterEach(cleanupRender)

  const messages = [
    {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "first prompt" }],
    },
    {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "text", text: "first answer" }],
    },
    {
      id: "user-2",
      role: "user",
      parts: [{ type: "text", text: "second prompt" }],
    },
    {
      id: "assistant-2",
      role: "assistant",
      parts: [{ type: "text", text: "streaming answer" }],
    },
  ] satisfies UIMessage[]

  function renderConversation({
    status = "ready",
    isSubmitting = false,
    onReload = vi.fn(),
  }: {
    status?: "streaming" | "ready" | "submitted" | "error"
    isSubmitting?: boolean
    onReload?: (messageId: string) => void
  } = {}) {
    cleanupRender()
    const mounted = document.createElement("div")
    document.body.appendChild(mounted)
    container = mounted
    root = createRoot(mounted)

    act(() => {
      root?.render(
        <Conversation
          messages={messages}
          status={status}
          isSubmitting={isSubmitting}
          onDelete={vi.fn()}
          onEdit={vi.fn()}
          onReload={onReload}
          isDurableChat
        />
      )
    })

    return onReload
  }

  it("withholds reload handlers while a generation is active", () => {
    const onReload = renderConversation({ status: "streaming" })
    const priorAssistant = container?.querySelector(
      '[data-testid="message-assistant-1"]'
    ) as HTMLButtonElement | null

    expect(priorAssistant?.dataset.canReload).toBe("false")

    act(() => {
      priorAssistant?.click()
    })

    expect(onReload).not.toHaveBeenCalled()
  })

  it("withholds reload handlers during submit preflight", () => {
    const onReload = renderConversation({ isSubmitting: true })
    const priorAssistant = container?.querySelector(
      '[data-testid="message-assistant-1"]'
    ) as HTMLButtonElement | null

    expect(priorAssistant?.dataset.canReload).toBe("false")

    act(() => {
      priorAssistant?.click()
    })

    expect(onReload).not.toHaveBeenCalled()
  })

  it("exposes reload handlers when the chat is idle", () => {
    const onReload = renderConversation()
    const priorAssistant = container?.querySelector(
      '[data-testid="message-assistant-1"]'
    ) as HTMLButtonElement | null

    expect(priorAssistant?.dataset.canReload).toBe("true")

    act(() => {
      priorAssistant?.click()
    })

    expect(onReload).toHaveBeenCalledWith("assistant-1")
  })

  it("routes the submitted pre-stream state through the activity assistant row", () => {
    cleanupRender()
    const mounted = document.createElement("div")
    document.body.appendChild(mounted)
    container = mounted
    root = createRoot(mounted)

    const userTail = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "hi" }] },
    ] satisfies UIMessage[]

    act(() => {
      root?.render(
        <Conversation
          messages={userTail}
          status="submitted"
          isSubmitting
          activityPanelTurnId={PENDING_ACTIVITY_TURN_ID}
          onDelete={vi.fn()}
          onEdit={vi.fn()}
          onReload={vi.fn()}
          isDurableChat
        />
      )
    })

    const pendingMessage = container?.querySelector(
      `[data-testid="message-${PENDING_ACTIVITY_TURN_ID}"]`
    ) as HTMLButtonElement | null

    expect(container?.querySelector('[data-testid="thinking"]')).toBeNull()
    expect(pendingMessage).toBeTruthy()
    expect(pendingMessage?.dataset.status).toBe("submitted")
    expect(pendingMessage?.dataset.activityPanelTurnId).toBe(
      PENDING_ACTIVITY_TURN_ID
    )
  })

  it("routes submit preflight through the activity assistant row before status flips", () => {
    cleanupRender()
    const mounted = document.createElement("div")
    document.body.appendChild(mounted)
    container = mounted
    root = createRoot(mounted)

    const userTail = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "hi" }] },
    ] satisfies UIMessage[]

    act(() => {
      root?.render(
        <Conversation
          messages={userTail}
          status="ready"
          isSubmitting
          activityPanelTurnId={PENDING_ACTIVITY_TURN_ID}
          onDelete={vi.fn()}
          onEdit={vi.fn()}
          onReload={vi.fn()}
          isDurableChat
        />
      )
    })

    const pendingMessage = container?.querySelector(
      `[data-testid="message-${PENDING_ACTIVITY_TURN_ID}"]`
    ) as HTMLButtonElement | null

    expect(container?.querySelector('[data-testid="thinking"]')).toBeNull()
    expect(pendingMessage).toBeTruthy()
    expect(pendingMessage?.dataset.status).toBe("submitted")
    expect(pendingMessage?.dataset.activityPanelTurnId).toBe(
      PENDING_ACTIVITY_TURN_ID
    )
  })
})
