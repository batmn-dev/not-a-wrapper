/** @vitest-environment jsdom */

import { deriveAssistantTurnView } from "@/lib/chat-messages/assistant-turn"
import type { UIMessage } from "@ai-sdk/react"
import React, { act } from "react"
import { createRoot, Root } from "react-dom/client"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { Message } from "./message"

// Render spy + last-received props, so memo-equality tests can observe whether
// the assistant body re-rendered and what props it received.
const messageAssistantSpy = vi.hoisted(() => vi.fn())
const lastAssistantProps = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}))

vi.mock("./message-assistant", () => ({
  MessageAssistant: (props: {
    children: React.ReactNode
    messageId: string
    onReload?: (messageId: string) => void
    retryModelId?: string
    onToolApproval?: (
      approvalId: string,
      approved: boolean,
      reason?: string
    ) => Promise<void> | void
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
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

const EMPTY_VIEW = deriveAssistantTurnView({ parts: [] }, "ready")

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
    retryModelId,
  }: {
    onToolApproval?: (
      approvalId: string,
      approved: boolean,
      reason?: string
    ) => Promise<void> | void
    onReload?: (messageId: string) => void
    retryModelId?: string
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
          view={EMPTY_VIEW}
          onDelete={() => {}}
          onEdit={() => {}}
          onReload={onReload}
          retryModelId={retryModelId}
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

  it("updates the assistant retry model when only the selected model changes", () => {
    renderMessage({ retryModelId: "gpt-5.4-mini" })
    renderMessage({ retryModelId: "gpt-5.5" })

    expect(lastAssistantProps.current.retryModelId).toBe("gpt-5.5")
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
    metadata?: unknown
    status?: "streaming" | "ready" | "submitted" | "error"
    isLast?: boolean
    children?: string
  }) {
    // Derive the view fresh each render — exactly what Conversation does. The
    // AI SDK mutates part objects in place, so the derivation must observe
    // mutations through the same parts reference.
    const view = deriveAssistantTurnView(
      { parts: props.parts, metadata: props.metadata },
      props.status ?? "ready"
    )
    act(() => {
      root?.render(
        <Message
          id="assistant-1"
          variant="assistant"
          isLast={props.isLast}
          status={props.status}
          view={view}
          onDelete={() => {}}
          onEdit={() => {}}
        >
          {props.children ?? ""}
        </Message>
      )
    })
  }

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

  it("re-renders the body when rendered tool input/output mutate in place", () => {
    const parts = [
      {
        type: "tool-search",
        toolCallId: "tool-call-1",
        state: "input-streaming",
        input: { query: "new" },
      },
    ] as unknown as UIMessage["parts"]
    const mutable = parts as unknown as Array<{
      state: "input-streaming" | "output-available"
      input: { query: string }
      output?: { summary: string; temperature?: string }
    }>

    renderAssistant({
      parts,
      status: "streaming",
      isLast: true,
      children: "",
    })
    expect(messageAssistantSpy).toHaveBeenCalledTimes(1)

    mutable[0].input.query = "new york weather"
    renderAssistant({
      parts,
      status: "streaming",
      isLast: true,
      children: "",
    })
    expect(messageAssistantSpy).toHaveBeenCalledTimes(2)

    const output: { summary: string; temperature?: string } = {
      summary: "Cloudy",
    }
    mutable[0].state = "output-available"
    mutable[0].output = output
    renderAssistant({
      parts,
      status: "streaming",
      isLast: true,
      children: "",
    })
    expect(messageAssistantSpy).toHaveBeenCalledTimes(3)

    output.temperature = "72 F"
    renderAssistant({
      parts,
      status: "streaming",
      isLast: true,
      children: "",
    })
    expect(messageAssistantSpy).toHaveBeenCalledTimes(4)
  })

  it("re-renders when the metadata identity changes (durable adoption)", () => {
    const parts = [
      { type: "text", text: "Answer" },
    ] as unknown as UIMessage["parts"]

    renderAssistant({
      parts,
      status: "ready",
      isLast: true,
      children: "Answer",
    })
    expect(messageAssistantSpy).toHaveBeenCalledTimes(1)

    // The metadata writers return a NEW object when server-owned keys change
    // (and the same reference on no-op), so identity is the change signal.
    renderAssistant({
      parts,
      metadata: { serverMessageId: "server-1", reasoningDurationMs: 2000 },
      status: "ready",
      isLast: true,
      children: "Answer",
    })
    expect(messageAssistantSpy).toHaveBeenCalledTimes(2)
  })
})
