/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { WebSearchControl } from "./web-search-control"

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render }: { render: React.ReactNode }) => <>{render}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <span data-testid="tooltip">{children}</span>
  ),
}))

describe("WebSearchControl", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeAll(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    root = null
    container = null
  })

  function renderControl({
    enabled,
    mode,
  }: Pick<React.ComponentProps<typeof WebSearchControl>, "enabled" | "mode">) {
    const onEnabledChange = vi.fn()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root?.render(
        <WebSearchControl
          enabled={enabled}
          mode={mode}
          onEnabledChange={onEnabledChange}
        />
      )
    })

    const button = container.querySelector("button") as HTMLButtonElement
    return { button, onEnabledChange }
  }

  it("shows an expanded-only grey off control that enables optional search", () => {
    const { button, onEnabledChange } = renderControl({
      enabled: false,
      mode: "optional",
    })

    expect(button.textContent).toBe("Search")
    expect(button.getAttribute("aria-pressed")).toBe("false")
    expect(button.className).toContain("text-[var(--text-tertiary)]")
    expect(button.className).toContain("hidden")
    expect(button.className).toContain(
      "group-data-expanded/composer:inline-flex"
    )
    expect(button.className).toContain("max-sm:inline-flex")
    expect(button.className).toContain("@max-[520px]/main:inline-flex")
    expect(
      container?.querySelector("[data-search-disable-icon]")
    ).toBeNull()
    expect(container?.querySelector("[data-testid=tooltip]")?.textContent).toBe(
      "Click to enable search"
    )

    act(() => button.click())
    expect(onEnabledChange).toHaveBeenCalledWith(true)
  })

  it("shows the blue globe and hover-removal glyph while optional search is on", () => {
    const { button, onEnabledChange } = renderControl({
      enabled: true,
      mode: "optional",
    })

    expect(button.getAttribute("aria-pressed")).toBe("true")
    expect(button.className).toContain(
      "text-[var(--composer-capability-accent)]"
    )
    expect(button.hasAttribute("data-search-toggleable")).toBe(true)
    expect(
      container?.querySelector("[data-search-disable-icon]")?.className
    ).toContain("hidden")
    expect(container?.querySelector("[data-testid=tooltip]")?.textContent).toBe(
      "Click to disable search"
    )

    act(() => button.click())
    expect(onEnabledChange).toHaveBeenCalledWith(false)
  })

  it("presents always-on search as blue and non-toggleable", () => {
    const { button, onEnabledChange } = renderControl({
      enabled: true,
      mode: "always-on",
    })

    expect(button.getAttribute("aria-pressed")).toBe("true")
    expect(button.getAttribute("aria-disabled")).toBe("true")
    expect(button.hasAttribute("data-search-toggleable")).toBe(false)
    expect(container?.querySelector("[data-testid=tooltip]")?.textContent).toBe(
      "Search is always on for this model"
    )

    act(() => button.click())
    expect(onEnabledChange).not.toHaveBeenCalled()
  })

  it("presents unsupported search as grey and non-toggleable", () => {
    const { button, onEnabledChange } = renderControl({
      enabled: false,
      mode: "unsupported",
    })

    expect(button.getAttribute("aria-pressed")).toBe("false")
    expect(button.getAttribute("aria-disabled")).toBe("true")
    expect(button.className).toContain("text-[var(--text-tertiary)]")
    expect(container?.querySelector("[data-testid=tooltip]")?.textContent).toBe(
      "This model doesn’t support web search"
    )

    act(() => button.click())
    expect(onEnabledChange).not.toHaveBeenCalled()
  })
})
