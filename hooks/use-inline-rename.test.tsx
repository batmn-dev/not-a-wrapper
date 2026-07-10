/** @vitest-environment jsdom */

import { InlineRenameInput } from "@/components/ui/inline-rename-input"
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { useInlineRename } from "./use-inline-rename"

type HarnessProps = {
  value: string
  onSave: (next: string) => void | Promise<void>
  onEditEnd?: () => void
}

function Harness({ value, onSave, onEditEnd }: HarnessProps) {
  const { isEditing, containerRef, start, inputProps, onContainerClick } =
    useInlineRename(value, onSave, onEditEnd ? { onEditEnd } : undefined)

  return (
    <div ref={containerRef} onClick={onContainerClick}>
      {isEditing ? (
        <InlineRenameInput
          data-testid="input"
          aria-label="Chat title"
          {...inputProps}
        />
      ) : (
        <button data-testid="start" onClick={start}>
          {value}
        </button>
      )}
    </div>
  )
}

describe("useInlineRename", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeAll(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true

    if (!globalThis.requestAnimationFrame) {
      globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
        cb(0)
        return 0
      }) as typeof requestAnimationFrame
      globalThis.cancelAnimationFrame =
        (() => {}) as typeof cancelAnimationFrame
    }
  })

  afterEach(() => {
    const mounted = root
    if (mounted) act(() => mounted.unmount())
    container?.remove()
    document.body.innerHTML = ""
    container = null
    root = null
  })

  function render(node: React.ReactElement) {
    if (!root) {
      container = document.createElement("div")
      document.body.appendChild(container)
      root = createRoot(container)
    }
    act(() => root?.render(node))
  }

  function input() {
    return document.querySelector(
      '[data-testid="input"]'
    ) as HTMLInputElement | null
  }

  function startButton() {
    return document.querySelector(
      '[data-testid="start"]'
    ) as HTMLButtonElement | null
  }

  function clickStart() {
    act(() =>
      startButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    )
  }

  function typeValue(value: string) {
    const el = input()
    if (!el) throw new Error("input not mounted")
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set
      setter?.call(el, value)
      el.dispatchEvent(new Event("input", { bubbles: true }))
    })
  }

  function keyDown(key: string) {
    const el = input()
    if (!el) throw new Error("input not mounted")
    act(() =>
      el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))
    )
  }

  it("enters edit mode showing the current value as the draft", () => {
    render(<Harness value="Hello" onSave={vi.fn()} />)
    expect(input()).toBeNull()
    expect(startButton()?.textContent).toBe("Hello")

    clickStart()
    expect(input()?.value).toBe("Hello")
  })

  it("focuses the editor and selects the entire title on entry", () => {
    render(<Harness value="Hello" onSave={vi.fn()} />)

    clickStart()

    expect(document.activeElement).toBe(input())
    expect(input()?.selectionStart).toBe(0)
    expect(input()?.selectionEnd).toBe(5)
  })

  it("uses the shared accessible title-editor contract", () => {
    render(<Harness value="Hello" onSave={vi.fn()} />)

    clickStart()

    expect(input()?.type).toBe("text")
    expect(input()?.name).toBe("title-editor")
    expect(input()?.getAttribute("aria-label")).toBe("Chat title")
  })

  it("commits a trimmed, changed value", () => {
    const onSave = vi.fn()
    render(<Harness value="Hello" onSave={onSave} />)
    clickStart()
    typeValue("  World  ")
    keyDown("Enter")

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith("World")
  })

  it("skips the commit when the value is unchanged", () => {
    const onSave = vi.fn()
    render(<Harness value="Hello" onSave={onSave} />)
    clickStart()
    keyDown("Enter")

    expect(onSave).not.toHaveBeenCalled()
    expect(startButton()).not.toBeNull() // exited edit mode
  })

  it("skips the commit when the value is emptied", () => {
    const onSave = vi.fn()
    render(<Harness value="Hello" onSave={onSave} />)
    clickStart()
    typeValue("   ")
    keyDown("Enter")

    expect(onSave).not.toHaveBeenCalled()
  })

  it("reverts without saving on Escape", () => {
    const onSave = vi.fn()
    render(<Harness value="Hello" onSave={onSave} />)
    clickStart()
    typeValue("Changed")
    keyDown("Escape")

    expect(onSave).not.toHaveBeenCalled()
    expect(startButton()?.textContent).toBe("Hello")
  })

  it("commits a changed value when clicking outside", () => {
    const onSave = vi.fn()
    render(<Harness value="Hello" onSave={onSave} />)
    clickStart()
    typeValue("World")

    act(() =>
      document.body.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true })
      )
    )

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith("World")
    expect(startButton()).not.toBeNull()
  })

  it("fires onEditEnd on both commit and cancel", () => {
    const onEditEnd = vi.fn()
    render(<Harness value="Hello" onSave={vi.fn()} onEditEnd={onEditEnd} />)

    clickStart()
    keyDown("Enter") // no-op commit still ends editing
    expect(onEditEnd).toHaveBeenCalledTimes(1)

    clickStart()
    keyDown("Escape")
    expect(onEditEnd).toHaveBeenCalledTimes(2)
  })

  it("resyncs the draft when the value changes externally while idle", () => {
    render(<Harness value="Hello" onSave={vi.fn()} />)
    render(<Harness value="Renamed" onSave={vi.fn()} />)

    clickStart()
    expect(input()?.value).toBe("Renamed")
  })
})
