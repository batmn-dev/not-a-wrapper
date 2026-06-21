/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { MessageUser } from "./message-user"

vi.mock("@/components/ui/scroll-root", () => ({
  useScrollRoot: () => ({
    stopScroll: vi.fn(),
    scrollRef: { current: null },
  }),
}))

vi.mock("next/image", () => ({
  default: () => null,
}))

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true
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

  it("keeps edit mode open when onEdit returns a failed result", async () => {
    const onEdit = vi.fn(async () => ({
      ok: false,
      reason: "message-not-found",
      message: "Message not found",
    }) as const)
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
    const cancelButton = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "Cancel"
    )
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
