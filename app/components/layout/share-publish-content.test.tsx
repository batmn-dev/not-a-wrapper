/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SharePublishContent } from "./share-publish-content"

describe("SharePublishContent", () => {
  let container: HTMLDivElement
  let root: Root
  const writeText = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    vi.useFakeTimers()
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    writeText.mockClear()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("keeps the shared fallback actions and accessible copy state", async () => {
    const onClose = vi.fn()
    const open = vi.spyOn(window, "open").mockImplementation(() => null)
    await act(async () => {
      root.render(<SharePublishContent chatId="chat-a" onClose={onClose} />)
    })

    const input = container.querySelector("input") as HTMLInputElement
    const copy = container.querySelector(
      'button[aria-label="Copy link"]'
    ) as HTMLButtonElement
    expect(input.readOnly).toBe(true)
    expect(input.labels?.[0]?.textContent).toContain("Public conversation link")

    await act(async () => copy.click())
    expect(writeText).toHaveBeenCalledWith(input.value)
    expect(copy.getAttribute("aria-label")).toBe("Copied")

    const viewPage = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "View Page"
    )
    act(() => viewPage?.click())
    expect(onClose).toHaveBeenCalledOnce()
    expect(open).toHaveBeenCalledWith(input.value, "_blank", "noopener")

    const shareOnX = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Share on")
    )
    act(() => shareOnX?.click())
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(open).toHaveBeenLastCalledWith(
      expect.stringContaining("https://x.com/intent/tweet"),
      "_blank",
      "noopener"
    )
  })
})
