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

  it("keeps composer interaction colors owned by the composer primitive", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(<Button variant="composer">Composer control</Button>)
    })

    const button = container.querySelector("button") as HTMLButtonElement
    expect(button.className).toContain("text-foreground")
    expect(button.className).not.toContain("hover:bg-interactive-hover")
    expect(button.className).not.toContain("active:bg-interactive-pressed")
    expect(button.className).toContain("active:scale-[0.96]")

    act(() => root.unmount())
    container.remove()
  })
})
