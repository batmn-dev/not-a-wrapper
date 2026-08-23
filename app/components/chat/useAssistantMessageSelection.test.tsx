/** @vitest-environment jsdom */
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { useAssistantMessageSelection } from "./useAssistantMessageSelection"

function SelectionHarness() {
  const { messageRef, selectionInfo } = useAssistantMessageSelection(true)

  return (
    <>
      <div ref={messageRef} data-message-id="assistant-1">
        <span>Selected response text</span>
      </div>
      <output>{selectionInfo?.text}</output>
    </>
  )
}

describe("useAssistantMessageSelection", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    window.getSelection()?.removeAllRanges()
  })

  it("captures a cloned DOM Range from the selected assistant message", () => {
    act(() => root.render(<SelectionHarness />))

    const text = container.querySelector("span")?.firstChild
    expect(text).toBeInstanceOf(Text)
    const range = document.createRange()
    range.selectNodeContents(text as Text)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    act(() =>
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
    )

    expect(container.querySelector("output")?.textContent).toBe(
      "Selected response text"
    )
  })

  it("dismisses the selection action when the next pointer starts outside the message", () => {
    act(() => root.render(<SelectionHarness />))

    const text = container.querySelector("span")?.firstChild as Text
    const range = document.createRange()
    range.selectNodeContents(text)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    act(() =>
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
    )

    const outside = document.createElement("button")
    document.body.appendChild(outside)
    act(() =>
      outside.dispatchEvent(new Event("pointerdown", { bubbles: true }))
    )

    expect(container.querySelector("output")?.textContent).toBe("")
    outside.remove()
  })
})
