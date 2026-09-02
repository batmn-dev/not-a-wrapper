/** @vitest-environment jsdom */

import { act, type FormEvent } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { Button } from "./button"

describe("Button visually disabled state", () => {
  it("matches the shared interaction contract without removing press scale", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(<Button>Send</Button>)
    })

    const button = container.querySelector("button") as HTMLButtonElement
    const classes = new Set(button.className.split(" "))

    expect(classes).toContain("min-h-9")
    expect(classes).toContain("pointer-coarse:min-h-10")
    expect(classes).toContain("keyboard-focused:outline-[1.5px]")
    expect(classes).toContain("keyboard-focused:outline-offset-[2.5px]")
    expect(classes).toContain("[&:active:not(:disabled)]:opacity-80")
    expect(classes).toContain("press-motion")
    expect(classes).not.toContain("keyboard-focused:ring-3")

    act(() => root.unmount())
    container.remove()
  })

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

    act(() => button.click())

    expect(onClick).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()

    act(() => root.unmount())
    container.remove()
  })

  it("offers an opt-in muted primary treatment for disabled actions", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        <Button disabled disabledVariant="muted">
          Create project
        </Button>
      )
    })

    const button = container.querySelector("button") as HTMLButtonElement
    const classes = new Set(button.className.split(" "))

    expect(button.disabled).toBe(true)
    expect(classes).toContain("disabled:bg-primary/50")
    expect(classes).toContain("disabled:hover:bg-primary/50")
    expect(classes).toContain("data-[visually-disabled]:bg-primary/50")
    expect(classes).toContain("data-[visually-disabled]:hover:bg-primary/50")
    expect(button.hasAttribute("disabledvariant")).toBe(false)

    act(() => root.unmount())
    container.remove()
  })

  it("keeps its label visible and prevents activation while loading", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    const onClick = vi.fn()

    act(() => {
      root.render(
        <Button loading onClick={onClick}>
          Create project
        </Button>
      )
    })

    const button = container.querySelector("button") as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.getAttribute("aria-busy")).toBe("true")
    expect(button.hasAttribute("data-loading")).toBe(true)
    expect(button.textContent).toContain("Create project")

    act(() => button.click())
    expect(onClick).not.toHaveBeenCalled()

    act(() => root.unmount())
    container.remove()
  })
})
