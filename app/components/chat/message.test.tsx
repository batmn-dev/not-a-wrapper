/** @vitest-environment jsdom */

import type { UIMessage } from "@ai-sdk/react"
import React, { act } from "react"
import { createRoot, Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { Message } from "./message"

// Render spy + last-received props, so memo-equality tests can observe whether
// the assistant body re-rendered and what props it received.
const messageAssistantSpy = vi.hoisted(() => vi.fn())
const lastAssistantProps = vi.hoisted(
  () => ({ current: {} as Record<string, unknown> })
)

vi.mock("./message-assistant", () => ({
  MessageAssistant: (props: {
    children: React.ReactNode
    messageId: string
    onReload?: (messageId: string) => void
    onToolApproval?: (
      approvalId: string,
      approved: boolean,
      reason?: string
    ) => Promise<void> | void
    activeTurnId?: string
  }) => {
    messageAssistantSpy()
    lastAssistantProps.current = props
    const { children, messageId, onReload, onToolApproval } = props
    return (
      <div>
        <button
          data-testid="approval"
          type="button"
          onClick={() => onToolApproval?.("approval-1", true)}
        >
          {children}
        </button>
        <button
          data-can-reload={Boolean(onReload)}
          data-testid="reload"
          type="button"
          onClick={() => onReload?.(messageId)}
        >
          reload
        </button>
      </div>
    )
  },
}))

vi.mock("./message-user", () => ({
  MessageUser: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true
})

describe("Message memoization", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

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

  function renderMessage({
    onToolApproval = vi.fn(),
    onReload,
  }: {
    onToolApproval?: (
      approvalId: string,
      approved: boolean,
      reason?: string
    ) => Promise<void> | void
    onReload?: (messageId: string) => void
  } = {}) {
    if (!container) {
      container = document.createElement("div")
      document.body.appendChild(container)
      root = createRoot(container)
    }

    act(() => {
      root?.render(
        <Message
          id="assistant-1"
          variant="assistant"
          onDelete={() => {}}
          onEdit={() => {}}
          onReload={onReload}
          onToolApproval={onToolApproval}
        >
          Approve this tool
        </Message>
      )
    })
  }

  it("updates the assistant tool approval handler when only the callback changes", () => {
    const firstApprovalHandler = vi.fn()
    const secondApprovalHandler = vi.fn()

    renderMessage({ onToolApproval: firstApprovalHandler })
    renderMessage({ onToolApproval: secondApprovalHandler })

    const button = container?.querySelector(
      '[data-testid="approval"]'
    ) as HTMLButtonElement | null

    expect(button).toBeTruthy()

    act(() => {
      button?.click()
    })

    expect(firstApprovalHandler).not.toHaveBeenCalled()
    expect(secondApprovalHandler).toHaveBeenCalledWith("approval-1", true)
  })

  it("updates assistant reload availability when only the callback presence changes", () => {
    const firstReloadHandler = vi.fn()
    const secondReloadHandler = vi.fn()

    renderMessage({ onReload: firstReloadHandler })
    renderMessage({ onReload: undefined })

    const reloadButton = container?.querySelector(
      '[data-testid="reload"]'
    ) as HTMLButtonElement | null

    expect(reloadButton).toBeTruthy()
    expect(reloadButton?.dataset.canReload).toBe("false")

    act(() => {
      reloadButton?.click()
    })

    expect(firstReloadHandler).not.toHaveBeenCalled()

    renderMessage({ onReload: secondReloadHandler })

    const updatedReloadButton = container?.querySelector(
      '[data-testid="reload"]'
    ) as HTMLButtonElement | null

    expect(updatedReloadButton?.dataset.canReload).toBe("true")

    act(() => {
      updatedReloadButton?.click()
    })

    expect(secondReloadHandler).toHaveBeenCalledWith("assistant-1")
  })
})

describe("Message body memo contract (R3)", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    messageAssistantSpy.mockClear()
    lastAssistantProps.current = {}
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

  function renderAssistant(props: {
    parts?: UIMessage["parts"]
    status?: "streaming" | "ready" | "submitted" | "error"
    isLast?: boolean
    activeTurnId?: string
    children?: string
  }) {
    act(() => {
      root?.render(
        <Message
          id="assistant-1"
          variant="assistant"
          isLast={props.isLast}
          activeTurnId={props.activeTurnId}
          status={props.status}
          parts={props.parts}
          onDelete={() => {}}
          onEdit={() => {}}
        >
          {props.children ?? ""}
        </Message>
      )
    })
  }

  const toolPart = (state: string) =>
    ({
      type: "tool-web_search",
      toolCallId: "t1",
      state,
      input: {},
    }) as unknown as NonNullable<UIMessage["parts"]>[number]

  it("does not re-render the body when only reasoning/source parts change during streaming", () => {
    const partsA = [
      { type: "reasoning", text: "thinking", state: "streaming" },
    ] as unknown as UIMessage["parts"]
    renderAssistant({
      parts: partsA,
      status: "streaming",
      isLast: true,
      children: "",
    })
    expect(messageAssistantSpy).toHaveBeenCalledTimes(1)

    const partsB = [
      { type: "reasoning", text: "thinking harder", state: "streaming" },
      {
        type: "source-url",
        sourceId: "s1",
        url: "https://example.com",
        title: "Example",
      },
    ] as unknown as UIMessage["parts"]
    renderAssistant({
      parts: partsB,
      status: "streaming",
      isLast: true,
      children: "",
    })

    // Reasoning + source deltas are panel-owned now; the body must not churn.
    expect(messageAssistantSpy).toHaveBeenCalledTimes(1)
  })

  it("re-renders the body on a real text delta during streaming", () => {
    renderAssistant({
      parts: [{ type: "text", text: "Hi" }] as unknown as UIMessage["parts"],
      status: "streaming",
      isLast: true,
      children: "Hi",
    })
    expect(messageAssistantSpy).toHaveBeenCalledTimes(1)

    renderAssistant({
      parts: [
        { type: "text", text: "Hi there" },
      ] as unknown as UIMessage["parts"],
      status: "streaming",
      isLast: true,
      children: "Hi there",
    })
    expect(messageAssistantSpy).toHaveBeenCalledTimes(2)
  })

  it("re-renders the body on a tool-state transition", () => {
    renderAssistant({
      parts: [toolPart("input-available")],
      status: "streaming",
      isLast: true,
      children: "",
    })
    expect(messageAssistantSpy).toHaveBeenCalledTimes(1)

    renderAssistant({
      parts: [toolPart("output-available")],
      status: "streaming",
      isLast: true,
      children: "",
    })
    expect(messageAssistantSpy).toHaveBeenCalledTimes(2)
  })

  it("re-renders and forwards the new activeTurnId on handoff", () => {
    const parts = [
      { type: "text", text: "Answer" },
    ] as unknown as UIMessage["parts"]

    renderAssistant({
      parts,
      status: "ready",
      isLast: true,
      activeTurnId: "turn-1",
      children: "Answer",
    })
    expect(messageAssistantSpy).toHaveBeenCalledTimes(1)
    expect(lastAssistantProps.current.activeTurnId).toBe("turn-1")

    renderAssistant({
      parts,
      status: "ready",
      isLast: true,
      activeTurnId: "turn-2",
      children: "Answer",
    })
    expect(messageAssistantSpy).toHaveBeenCalledTimes(2)
    expect(lastAssistantProps.current.activeTurnId).toBe("turn-2")
  })
})
