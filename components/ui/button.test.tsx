/** @vitest-environment jsdom */

import { act, type FormEvent } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { Button } from "./button"

describe("Button visually disabled state", () => {
  it("stays focusable while canceling click and form submission", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    const onClick = vi.fn()
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault())

    act(() => {
      root.render(
        <form onSubmit={onSubmit}>
          <Button visuallyDisabled type="submit" onClick={onClick}>
            Send
          </Button>
        </form>
      )
    })

    const button = container.querySelector("button") as HTMLButtonElement
    expect(button.disabled).toBe(false)
    expect(button.tabIndex).toBe(0)
    expect(button.getAttribute("aria-disabled")).toBe("true")
    expect(button.hasAttribute("data-visually-disabled")).toBe(true)
    expect(button.className).toContain("keyboard-focused:ring-3")
    expect(button.className).not.toContain("focus-visible:ring-3")

    act(() => button.click())

    expect(onClick).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()

    act(() => root.unmount())
    container.remove()
  })
})
