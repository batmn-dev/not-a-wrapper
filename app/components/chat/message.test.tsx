/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { Message } from "./message"

vi.mock("./message-assistant", () => ({
  MessageAssistant: ({
    children,
    onToolApproval,
  }: {
    children: React.ReactNode
    onToolApproval?: (
      approvalId: string,
      approved: boolean,
      reason?: string
    ) => Promise<void> | void
  }) => (
    <button
      data-testid="approval"
      type="button"
      onClick={() => onToolApproval?.("approval-1", true)}
    >
      {children}
    </button>
  ),
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

  function renderMessage(
    onToolApproval: (
      approvalId: string,
      approved: boolean,
      reason?: string
    ) => Promise<void> | void
  ) {
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
          onReload={() => {}}
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

    renderMessage(firstApprovalHandler)
    renderMessage(secondApprovalHandler)

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
})
