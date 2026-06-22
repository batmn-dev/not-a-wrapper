/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { Message } from "./message"

vi.mock("./message-assistant", () => ({
  MessageAssistant: ({
    children,
    messageId,
    onReload,
    onToolApproval,
  }: {
    children: React.ReactNode
    messageId: string
    onReload?: (messageId: string) => void
    onToolApproval?: (
      approvalId: string,
      approved: boolean,
      reason?: string
    ) => Promise<void> | void
  }) => (
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
