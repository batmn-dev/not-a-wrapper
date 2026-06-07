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
