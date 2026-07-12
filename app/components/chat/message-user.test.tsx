/** @vitest-environment jsdom */

import type { MessageBranchInfo } from "@/lib/chat-messages/branch"
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { MessageUser } from "./message-user"

vi.mock("next/image", () => ({
  default: () => null,
}))

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

describe("MessageUser attachments", () => {
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
    attachments: Parameters<typeof MessageUser>[0]["attachments"]
  ) {
    const mountedContainer = document.createElement("div")
    document.body.appendChild(mountedContainer)
    container = mountedContainer
    root = createRoot(mountedContainer)

    act(() => {
      root?.render(
        <MessageUser
          attachments={attachments}
          copied={false}
          copyToClipboard={() => {}}
          id="message-1"
        >
          Upload smoke test
        </MessageUser>
      )
    })
  }

  it("renders text/plain attachment metadata from stored file parts", () => {
    renderMessage([
      {
        name: "not-a-wrapper-upload-smoke.txt",
        contentType: "text/plain",
        url: "https://files.example/smoke.txt",
      },
    ])

    expect(container?.textContent).toContain("not-a-wrapper-upload-smoke.txt")
    expect(container?.textContent).toContain("text/plain")
    expect(
      container?.querySelector(
        'a[aria-label="Open attachment not-a-wrapper-upload-smoke.txt"]'
      )
    ).toBeTruthy()
  })
})

describe("MessageUser edits", () => {
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

  function renderEditableMessage(
    props: Partial<Parameters<typeof MessageUser>[0]> = {}
  ) {
    const mountedContainer = document.createElement("div")
    document.body.appendChild(mountedContainer)
    container = mountedContainer
    root = createRoot(mountedContainer)

    act(() => {
      root?.render(
        <MessageUser
          copied={false}
          copyToClipboard={() => {}}
          id="msg-client-123"
          isDurableChat={true}
          {...props}
        >
          Original text
        </MessageUser>
      )
    })
  }

  function openEditor() {
    const editButton = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit message"]'
    )
    expect(editButton).toBeTruthy()
    act(() => {
      editButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
  }

  function updateTextarea(value: string) {
    const textarea = container?.querySelector<HTMLTextAreaElement>("textarea")
    expect(textarea).toBeTruthy()
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )?.set
    valueSetter?.call(textarea, value)
    act(() => {
      textarea?.dispatchEvent(new Event("input", { bubbles: true }))
    })
  }

  async function clickSend() {
    const sendButton = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "Send"
    )
    expect(sendButton).toBeTruthy()
    await act(async () => {
      sendButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
  }

  it("submits edits for AI SDK client IDs", async () => {
    const onEdit = vi.fn(async () => ({ ok: true }) as const)
    renderEditableMessage({ onEdit })

    openEditor()
    updateTextarea("Edited text")
    await clickSend()

    expect(onEdit).toHaveBeenCalledWith("msg-client-123", "Edited text")
    expect(container?.querySelector("textarea")).toBeNull()
  })

  it("hides the edit control on a non-durable chat", () => {
    renderEditableMessage({ onEdit: vi.fn(), isDurableChat: false })

    const editButton = container?.querySelector(
      'button[aria-label="Edit message"]'
    )
    expect(editButton).toBeNull()
  })

  it("composes branch navigation into the hover-revealed action family", () => {
    const branch: MessageBranchInfo = {
      messageId: "msg-client-123",
      currentIndex: 1,
      total: 3,
      siblings: [
        { messageId: "msg-client-122" },
        { messageId: "msg-client-123" },
        { messageId: "msg-client-124" },
      ],
    }
    renderEditableMessage({ branch, onSelectBranch: vi.fn() })

    const branchControls = container?.querySelector(
      '[aria-label="Branch 2 of 3"]'
    )
    const actionFamily = branchControls?.parentElement

    expect(
      actionFamily?.querySelector('button[aria-label="Copy Message"]')
    ).toBeTruthy()
    expect(
      actionFamily?.querySelector('button[aria-label="Edit message"]')
    ).toBeTruthy()
    expect(
      actionFamily?.querySelector('button[aria-label="Previous branch"]')
    ).toBeTruthy()
    expect(
      actionFamily?.querySelector('button[aria-label="Next branch"]')
    ).toBeTruthy()

    const copyButton = actionFamily?.querySelector<HTMLButtonElement>(
      'button[aria-label="Copy Message"]'
    )
    const editButton = actionFamily?.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit message"]'
    )
    const previousButton = actionFamily?.querySelector<HTMLButtonElement>(
      'button[aria-label="Previous branch"]'
    )
    const nextButton = actionFamily?.querySelector<HTMLButtonElement>(
      'button[aria-label="Next branch"]'
    )

    expect(copyButton?.className).toBe(editButton?.className)
    expect(previousButton?.className).toBe(nextButton?.className)
    expect(copyButton?.className).toContain("h-8")
    expect(copyButton?.className).toContain("w-8")
    // Reference branch steppers (live-measured 2026-07-11): 24×30, distinct
    // from the 32px action buttons.
    expect(previousButton?.className).toContain("h-[30px]")
    expect(previousButton?.className).toContain("w-[24px]")
    expect(actionFamily?.className).toContain("-ms-2.5")
    expect(actionFamily?.className).toContain("-me-1")
    expect(actionFamily?.className).toContain("p-1")
    expect(actionFamily?.getAttribute("aria-label")).toBe(
      "Your message actions"
    )
  })

  it("matches the user-only delayed opacity reveal contract", () => {
    renderEditableMessage()

    const actions = container?.querySelector(
      '[aria-label="Your message actions"]'
    )
    expect(actions).toBeTruthy()

    const expectedClasses = [
      "pointer-events-none",
      "opacity-0",
      "select-none",
      "motion-safe:transition-opacity",
      "duration-300",
      "group-hover/turn-messages:delay-300",
      "group-hover/turn-messages:pointer-events-auto",
      "group-hover/turn-messages:opacity-100",
      "group-focus-within/turn-messages:pointer-events-auto",
      "group-focus-within/turn-messages:opacity-100",
      "has-[[data-state=open]]:pointer-events-auto",
      "has-[[data-state=open]]:opacity-100",
      "focus-within:transition-none",
      "hover:transition-none",
      "pointer-coarse:pointer-events-auto",
      "pointer-coarse:opacity-100",
    ]

    for (const className of expectedClasses) {
      expect(actions?.className).toContain(className)
    }
    expect(actions?.className).not.toContain("mask-image")
    expect(actions?.className).not.toContain("mask-position")
  })

  it("keeps edit mode open when onEdit returns a failed result", async () => {
    const onEdit = vi.fn(
      async () =>
        ({
          ok: false,
          reason: "message-not-found",
          message: "Message not found",
        }) as const
    )
    renderEditableMessage({ onEdit })

    openEditor()
    updateTextarea("Edited text")
    await clickSend()

    expect(onEdit).toHaveBeenCalledWith("msg-client-123", "Edited text")
    expect(container?.querySelector("textarea")).toBeTruthy()
    expect(container?.querySelector('[role="alert"]')?.textContent).toBe(
      "Message not found"
    )
  })

  it("keeps edit mode open when onEdit rejects", async () => {
    const onEdit = vi.fn(async () => {
      throw new Error("send failed")
    })
    renderEditableMessage({ onEdit })

    openEditor()
    updateTextarea("Edited text")
    await clickSend()

    expect(onEdit).toHaveBeenCalledWith("msg-client-123", "Edited text")
    expect(container?.querySelector("textarea")).toBeTruthy()
    expect(container?.querySelector('[role="alert"]')?.textContent).toBe(
      "Failed to submit the edit. Please try again."
    )
  })

  it("cancels edit without submitting and restores original content", () => {
    const onEdit = vi.fn()
    renderEditableMessage({ onEdit })

    openEditor()
    updateTextarea("Edited text")
    const cancelButton = [
      ...(container?.querySelectorAll("button") ?? []),
    ].find((button) => button.textContent === "Cancel")
    expect(cancelButton).toBeTruthy()
    act(() => {
      cancelButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onEdit).not.toHaveBeenCalled()
    expect(container?.querySelector("textarea")).toBeNull()
    expect(container?.textContent).toContain("Original text")
    expect(container?.textContent).not.toContain("Edited text")
  })
})
