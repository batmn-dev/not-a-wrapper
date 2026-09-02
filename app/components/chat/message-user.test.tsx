/** @vitest-environment jsdom */

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
    vi.restoreAllMocks()
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
          isEditing={false}
          onEditingChange={() => {}}
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

  it("names the image lightbox after the attachment", () => {
    renderMessage([
      {
        name: "photo.png",
        contentType: "image/png",
        url: "https://files.example/photo.png",
      },
    ])

    const trigger = container?.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]'
    )
    act(() => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    const dialog = document.querySelector('[role="dialog"]')
    const labelId = dialog?.getAttribute("aria-labelledby") ?? ""
    expect(document.getElementById(labelId)?.textContent).toBe(
      "Attachment preview: photo.png"
    )
  })

  it("leaves the role heading to the owning turn section", () => {
    renderMessage(undefined)

    expect(container?.querySelector("h4")).toBeNull()
  })

  it("matches the source-backed sent-message ownership chain", () => {
    renderMessage(undefined)

    const message = container?.querySelector(
      '[data-message-author-role="user"]'
    )
    const stack = message?.firstElementChild
    const widthOwner = stack?.lastElementChild
    const contentsWrapper = widthOwner?.firstElementChild
    const bubble = contentsWrapper?.firstElementChild

    expect(message?.className).toContain("outline-none")
    expect(message?.className).toContain("font-native")
    expect(message?.className).toContain("keyboard-focused:focus-ring")
    expect(stack?.className).toContain("rtl:items-start")
    expect(widthOwner?.className).toContain("w-fit")
    expect(widthOwner?.className).toContain("max-w-(--user-chat-width,70%)")
    expect(contentsWrapper?.className).toBe("contents w-full")
    expect(bubble?.className).toContain("rounded-[22px]")
    expect(bubble?.className).toContain("px-4 py-2.5 leading-6")
    expect(bubble?.className).toContain("user-message-bubble-color")
    expect(bubble?.className).toContain("corner-superellipse/0.98")
    expect(
      bubble?.querySelector('[data-testid="collapsible-user-message-root"]')
    ).toBeTruthy()
  })

  it("collapses overflowing messages to the captured 264px boundary", () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(528)
    renderMessage(undefined)

    const content = container?.querySelector<HTMLElement>(
      '[data-testid="collapsible-user-message-content"]'
    )
    const toggle = container?.querySelector<HTMLButtonElement>(
      '[data-testid="collapsible-user-message-toggle"]'
    )

    expect(content?.className).toContain("max-h-[264px]")
    expect(content?.className).toContain("overflow-clip")
    expect(content?.className).toContain("100%_-_48px")
    expect(toggle?.getAttribute("aria-expanded")).toBe("false")
    expect(toggle?.textContent).toContain("Show more")

    const toggleIconWrapper = toggle?.lastElementChild
    const toggleIcon = toggleIconWrapper?.querySelector("svg")

    expect(toggleIconWrapper?.tagName).toBe("DIV")
    expect(toggleIconWrapper?.className).toContain("size-4")
    expect(toggleIcon?.getAttribute("viewBox")).toBe("0 0 16 16")
    expect(toggleIcon?.classList.contains("size-4")).toBe(true)

    act(() => {
      toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(content?.className).not.toContain("max-h-[264px]")
    expect(toggle?.getAttribute("aria-expanded")).toBe("true")
    expect(toggle?.textContent).toContain("Show less")
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

    // Lets a test close the editor from the parent, the way Chat does when a
    // turn changes underneath a pending edit.
    const parent = { setEditing: (_isEditing: boolean) => {} }

    function ControlledEditableMessage() {
      const [isEditing, setIsEditing] = React.useState(false)
      React.useEffect(() => {
        parent.setEditing = setIsEditing
      }, [])

      return (
        <MessageUser
          copied={false}
          copyToClipboard={() => {}}
          id="msg-client-123"
          isDurableChat={true}
          {...props}
          isEditing={isEditing}
          onEditingChange={setIsEditing}
        >
          Original text
        </MessageUser>
      )
    }

    act(() => {
      root?.render(<ControlledEditableMessage />)
    })
    return parent
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

  it("matches the regular Chat sent-message action order", () => {
    const sharePrompt = vi.fn()
    renderEditableMessage({ onEdit: vi.fn(), sharePrompt })

    const actions = [
      ...(container?.querySelectorAll(
        '[aria-label="Your message actions"] button[aria-label]'
      ) ?? []),
    ]

    expect(actions.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Copy message",
      "Share prompt",
      "Edit message",
    ])
    expect(actions[1]?.getAttribute("data-testid")).toBe(
      "share-prompt-link-turn-action-button"
    )

    act(() => {
      actions[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(sharePrompt).toHaveBeenCalledOnce()
  })

  it("replaces the sent-message subtree with the source-backed editor", () => {
    renderEditableMessage({ onEdit: vi.fn() })

    openEditor()

    const editor = container?.firstElementChild
    const scrollOwner = editor?.children[0]
    const textarea = container?.querySelector("textarea")
    const sizingSpan = textarea?.nextElementSibling
    const actionRow = editor?.lastElementChild

    expect(editor?.className).toContain("rounded-3xl")
    expect(editor?.className).not.toContain("corner-shape")
    expect(editor?.className).toContain("bg-secondary")
    expect(editor?.className).toContain("font-native")
    expect(editor?.className).toContain("px-3 py-3")
    expect(scrollOwner?.className).toBe("m-2 max-h-[25dvh] overflow-auto")
    expect(
      container?.querySelector('[data-message-author-role="user"]')
    ).toBeNull()
    expect(
      container?.querySelector('[aria-label="Your message actions"]')
    ).toBeNull()
    expect(textarea?.getAttribute("aria-label")).toBe("Edit message")
    expect(textarea?.className).toContain(
      "col-start-1 col-end-2 row-start-1 row-end-2"
    )
    expect(textarea?.className).toContain(
      "w-full resize-none overflow-hidden p-0 m-0 w-full resize-none border-0 bg-transparent focus:ring-0 focus-visible:ring-0"
    )
    expect(textarea?.getAttribute("style")).toBeNull()
    expect(sizingSpan?.className).toContain("invisible")
    expect(sizingSpan?.className).toContain("whitespace-pre-wrap")
    expect(actionRow?.className).toBe(
      "flex flex-wrap justify-end gap-2 px-2 pt-2"
    )
    expect(document.activeElement).toBe(textarea)
    expect((textarea as HTMLTextAreaElement | undefined)?.selectionStart).toBe(
      "Original text".length
    )
  })

  it("uses ChatGPT's edit keyboard contract", async () => {
    const onEdit = vi.fn(async () => ({ ok: true }) as const)
    renderEditableMessage({ onEdit })
    openEditor()

    const textarea = container?.querySelector<HTMLTextAreaElement>("textarea")
    expect(textarea).toBeTruthy()

    act(() => {
      textarea?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })
      )
    })
    expect(onEdit).not.toHaveBeenCalled()

    await act(async () => {
      textarea?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Enter",
          metaKey: true,
        })
      )
    })

    expect(onEdit).toHaveBeenCalledWith("msg-client-123", "Original text")
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

  it("drops a second Send while the edit request is pending, without locking the editor", async () => {
    let settle: (() => void) | undefined
    const onEdit = vi.fn(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          settle = () => resolve({ ok: true })
        })
    )
    renderEditableMessage({ onEdit })

    openEditor()
    updateTextarea("Edited text")
    await clickSend()
    await clickSend()

    const textarea = container?.querySelector<HTMLTextAreaElement>("textarea")
    expect(onEdit).toHaveBeenCalledOnce()
    expect(textarea?.readOnly).toBe(false)
    expect(textarea?.hasAttribute("aria-busy")).toBe(false)

    await act(async () => {
      settle?.()
    })
    expect(container?.querySelector("textarea")).toBeNull()
  })

  it("ignores a save that settles after the editor was closed and reopened", async () => {
    let settle: (() => void) | undefined
    const onEdit = vi.fn(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          settle = () => resolve({ ok: true })
        })
    )
    const parent = renderEditableMessage({ onEdit })

    openEditor()
    updateTextarea("First draft")
    await clickSend()

    act(() => {
      parent.setEditing(false)
    })
    expect(container?.querySelector("textarea")).toBeNull()
    openEditor()
    updateTextarea("Second draft")

    await act(async () => {
      settle?.()
    })

    const textarea = container?.querySelector<HTMLTextAreaElement>("textarea")
    expect(textarea?.value).toBe("Second draft")
    expect(onEdit).toHaveBeenCalledOnce()
  })

  it("keeps a newer save's guard when an older save settles after reopen", async () => {
    const settlers: Array<() => void> = []
    const onEdit = vi.fn(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          settlers.push(() => resolve({ ok: true }))
        })
    )
    const parent = renderEditableMessage({ onEdit })

    openEditor()
    updateTextarea("First draft")
    await clickSend()
    act(() => {
      parent.setEditing(false)
    })
    openEditor()
    updateTextarea("Second draft")
    await clickSend()

    // Save A settles while save B is pending; a third Send must still be dropped.
    await act(async () => {
      settlers[0]?.()
    })
    await clickSend()
    expect(onEdit).toHaveBeenCalledTimes(2)

    await act(async () => {
      settlers[1]?.()
    })
    expect(container?.querySelector("textarea")).toBeNull()
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
