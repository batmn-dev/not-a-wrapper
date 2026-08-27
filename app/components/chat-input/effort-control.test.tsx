/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { EffortControl } from "./effort-control"

let dropdownAnchor: React.RefObject<Element | null> | undefined

vi.mock("motion/react", () => ({
  useReducedMotion: () => false,
}))

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({
    children,
    modal,
  }: {
    children: React.ReactNode
    modal?: boolean
  }) => <div data-modal={String(modal)}>{children}</div>,
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
  })

  it("scales a visual press surface while keeping the menu anchor fixed", () => {
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
      '[data-slot="effort-control-press-surface"]'
    )
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="effort-trigger"]'
    )

    expect(anchor).not.toBeNull()
    expect(pressSurface?.contains(trigger ?? null)).toBe(true)
    expect(dropdownAnchor?.current).toBe(anchor)
    expect(dropdownAnchor?.current).not.toBe(trigger)
    expect(trigger?.className).toContain("active:scale-100")
    expect(container.querySelector("[data-modal=false]")).not.toBeNull()

    if (!pressSurface) return

    const pressAnimation = {
      cancel: vi.fn(),
      onfinish: null,
    } as unknown as Animation
    const returnAnimation = {
      cancel: vi.fn(),
      onfinish: null,
    } as unknown as Animation
    const animate = vi
      .fn<() => Animation>()
      .mockReturnValueOnce(pressAnimation)
      .mockReturnValueOnce(returnAnimation)
    Object.defineProperty(pressSurface, "animate", {
      configurable: true,
      value: animate,
    })

    const pointerDown = new Event("pointerdown", { bubbles: true })
    Object.defineProperties(pointerDown, {
      button: { value: 0 },
      isPrimary: { value: true },
      pointerId: { value: 11 },
    })
    act(() => pressSurface.dispatchEvent(pointerDown))

    expect(animate).toHaveBeenCalledWith(
      [{ transform: "scale(1)" }, { transform: "scale(0.96)" }],
      {
        duration: 75,
        easing: "cubic-bezier(0.4, 0, 0.2, 1)",
        fill: "forwards",
      }
    )

    const pointerUp = new Event("pointerup")
    Object.defineProperty(pointerUp, "pointerId", { value: 11 })
    act(() => window.dispatchEvent(pointerUp))
    expect(animate).toHaveBeenCalledOnce()

    act(() => {
      pressAnimation.onfinish?.call(
        pressAnimation,
        new Event("finish") as AnimationPlaybackEvent
      )
    })

    expect(animate).toHaveBeenNthCalledWith(
      2,
      [{ transform: "scale(0.96)" }, { transform: "scale(1)" }],
      {
        duration: 75,
        easing: "cubic-bezier(0.4, 0, 0.2, 1)",
        fill: "forwards",
      }
    )
    expect(pressAnimation.cancel).toHaveBeenCalledOnce()
  })
})
