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

  function rerenderControl(
    props: React.ComponentProps<typeof WebSearchControl>
  ) {
    act(() => {
      root?.render(<WebSearchControl {...props} />)
    })
    return container?.querySelector("button") as HTMLButtonElement
  }

  function dispatchPointerEvent(
    button: HTMLButtonElement,
    type: "pointerover" | "pointerout",
    pointerType = "mouse"
  ) {
    const event = new MouseEvent(type, {
      bubbles: true,
      relatedTarget: type === "pointerout" ? document.body : null,
    })
    Object.defineProperty(event, "pointerType", { value: pointerType })
    act(() => button.dispatchEvent(event))
  }

  it("shows a responsive grey off control that enables optional search", () => {
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
      Array.from(button.querySelectorAll("span")).find(
        (element) => element.textContent === "Search"
      )?.className
    ).toContain("max-[520px]:sr-only")
    expect(
      Array.from(button.querySelectorAll("span")).find(
        (element) => element.textContent === "Search"
      )?.className
    ).not.toContain("max-sm:sr-only")
    expect(
      container?.querySelectorAll("[data-search-control-icon]")
    ).toHaveLength(1)
    expect(
      container
        ?.querySelector("[data-search-control-icon]")
        ?.getAttribute("data-search-icon")
    ).toBe("off")
    expect(container?.querySelector("[data-testid=tooltip]")?.textContent).toBe(
      "Click to enable search"
    )

    act(() => button.click())
    expect(onEnabledChange).toHaveBeenCalledWith(true)
  })

  it("shows the active globe before mouse hover", () => {
    const { button, onEnabledChange } = renderControl({
      enabled: true,
      mode: "optional",
    })

    expect(button.getAttribute("aria-pressed")).toBe("true")
    expect(button.className).toContain(
      "text-[var(--composer-capability-accent)]"
    )
    expect(button.hasAttribute("data-search-toggleable")).toBe(true)
    expect(button.hasAttribute("data-search-disable-visible")).toBe(false)
    expect(
      container?.querySelectorAll("[data-search-control-icon]")
    ).toHaveLength(1)
    expect(
      container
        ?.querySelector("[data-search-control-icon]")
        ?.getAttribute("data-search-icon")
    ).toBe("globe")
    expect(container?.querySelector("[data-testid=tooltip]")?.textContent).toBe(
      "Click to disable search"
    )

    act(() => button.click())
    expect(onEnabledChange).toHaveBeenCalledWith(false)
  })

  it("waits for mouse leave and re-entry before revealing disable", () => {
    const { button, onEnabledChange } = renderControl({
      enabled: false,
      mode: "optional",
    })
    dispatchPointerEvent(button, "pointerover")
    act(() => button.click())
    const enabledButton = rerenderControl({
      enabled: true,
      mode: "optional",
      onEnabledChange,
    })

    const icon = () =>
      container
        ?.querySelector("[data-search-control-icon]")
        ?.getAttribute("data-search-icon")

    expect(icon()).toBe("globe")
    expect(enabledButton.hasAttribute("data-search-disable-hover")).toBe(false)

    dispatchPointerEvent(enabledButton, "pointerout")
    expect(icon()).toBe("globe")
    expect(enabledButton.hasAttribute("data-search-disable-hover")).toBe(true)

    dispatchPointerEvent(enabledButton, "pointerover")
    expect(icon()).toBe("remove")
    expect(enabledButton.hasAttribute("data-search-disable-visible")).toBe(true)

    dispatchPointerEvent(enabledButton, "pointerout")
    expect(icon()).toBe("globe")

    dispatchPointerEvent(enabledButton, "pointerover")
    expect(icon()).toBe("remove")
    act(() => enabledButton.click())
    rerenderControl({
      enabled: false,
      mode: "optional",
      onEnabledChange,
    })

    expect(onEnabledChange).toHaveBeenLastCalledWith(false)
    expect(icon()).toBe("off")
  })

  it("presents always-on search as blue and non-toggleable", () => {
    const { button, onEnabledChange } = renderControl({
      enabled: true,
      mode: "always-on",
    })

    expect(button.getAttribute("aria-pressed")).toBe("true")
    expect(button.getAttribute("aria-disabled")).toBe("true")
    expect(button.hasAttribute("data-search-toggleable")).toBe(false)
    dispatchPointerEvent(button, "pointerover")
    expect(
      container
        ?.querySelector("[data-search-control-icon]")
        ?.getAttribute("data-search-icon")
    ).toBe("globe")
    expect(container?.querySelector("[data-testid=tooltip]")?.textContent).toBe(
      "Search is always on for this model"
    )

    act(() => button.click())
    expect(onEnabledChange).not.toHaveBeenCalled()
  })

  it("keeps the state icon as a globe and exposes the compact touch removal", () => {
    const { button } = renderControl({
      enabled: true,
      mode: "optional",
    })

    dispatchPointerEvent(button, "pointerover", "touch")

    expect(button.hasAttribute("data-search-disable-visible")).toBe(false)
    expect(
      container
        ?.querySelector("[data-search-control-icon]")
        ?.getAttribute("data-search-icon")
    ).toBe("globe")
    expect(button.className).toContain("cant-hover:ps-2.5")
    expect(button.className).toContain("cant-hover:pe-3.5")
    expect(button.className).toContain(
      "cant-hover:aria-pressed:bg-[var(--composer-capability-accent-hover-surface)]!"
    )
    expect(
      container?.querySelector("[data-search-touch-remove-icon]")?.className
    ).toContain("cant-hover:inline-flex")
    expect(
      Array.from(button.querySelectorAll("span")).find(
        (element) => element.textContent === "Search"
      )?.className
    ).toContain("max-[520px]:sr-only")
    expect(
      Array.from(button.querySelectorAll("span")).find(
        (element) => element.textContent === "Search"
      )?.className
    ).not.toContain("max-sm:sr-only")
  })

  it("presents unsupported search as grey and non-toggleable", () => {
    const { button, onEnabledChange } = renderControl({
      enabled: false,
      mode: "unsupported",
    })

    expect(button.getAttribute("aria-pressed")).toBe("false")
    expect(button.getAttribute("aria-disabled")).toBe("true")
    expect(button.className).toContain("text-[var(--text-tertiary)]")
    dispatchPointerEvent(button, "pointerover")
    expect(
      container
        ?.querySelector("[data-search-control-icon]")
        ?.getAttribute("data-search-icon")
    ).toBe("off")
    expect(container?.querySelector("[data-testid=tooltip]")?.textContent).toBe(
      "This model doesn’t support web search"
    )

    act(() => button.click())
    expect(onEnabledChange).not.toHaveBeenCalled()
  })
})
