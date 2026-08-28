/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { EffortControl } from "./effort-control"

let dropdownAnchor: React.RefObject<Element | null> | undefined
let changeDropdownOpen: ((open: boolean) => void) | undefined

vi.mock("motion/react", () => ({
  useReducedMotion: () => false,
}))

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({
    children,
    modal,
    onOpenChange,
  }: {
    children: React.ReactNode
    modal?: boolean
    onOpenChange?: (open: boolean) => void
  }) => {
    changeDropdownOpen = onOpenChange
    return <div data-modal={String(modal)}>{children}</div>
  },
  DropdownMenuTrigger: ({
    children,
    render,
  }: {
    children: React.ReactNode
    render: React.ReactElement<Record<string, unknown>>
  }) =>
    React.cloneElement(render, { "data-testid": "effort-trigger" }, children),
  DropdownMenuContent: ({
    anchor,
    children,
  }: {
    anchor?: React.RefObject<Element | null>
    children: React.ReactNode
  }) => {
    dropdownAnchor = anchor
    return <div data-testid="effort-menu">{children}</div>
  },
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode
    onClick: () => void
  }) => <button onClick={onClick}>{children}</button>,
}))

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({
    children,
    render,
  }: {
    children: React.ReactNode
    render: React.ReactElement<Record<string, unknown>>
  }) => React.cloneElement(render, {}, children),
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}))

describe("EffortControl", () => {
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
    dropdownAnchor = undefined
    changeDropdownOpen = undefined
  })

  it("keeps the visual control still and the menu anchor fixed", () => {
    act(() => {
      root.render(
        <EffortControl
          levels={["low", "high"]}
          value={undefined}
          defaultLevel="low"
          onChange={() => {}}
        />
      )
    })

    const anchor = container.querySelector<HTMLDivElement>(
      '[data-slot="effort-control-desktop-anchor"]'
    )
    const pressSurface = container.querySelector<HTMLDivElement>(
      '[data-slot="effort-control-visual-surface"]'
    )
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="effort-trigger"]'
    )

    expect(anchor).not.toBeNull()
    expect(pressSurface?.contains(trigger ?? null)).toBe(true)
    expect(dropdownAnchor?.current).toBe(anchor)
    expect(dropdownAnchor?.current).not.toBe(trigger)
    expect(pressSurface?.className).not.toContain("press-motion")
    expect(trigger?.className).not.toContain("press-motion")
    expect(container.querySelector("[data-modal=false]")).not.toBeNull()
  })

  it("opens the thinking menu as soon as the button is pressed", () => {
    act(() => {
      root.render(
        <EffortControl
          levels={["low", "high"]}
          value={undefined}
          defaultLevel="low"
          onChange={() => {}}
        />
      )
    })

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="effort-trigger"]'
    )
    expect(trigger?.getAttribute("aria-expanded")).toBe("false")

    act(() => {
      changeDropdownOpen?.(true)
    })
    expect(trigger?.getAttribute("aria-expanded")).toBe("true")
  })
})
