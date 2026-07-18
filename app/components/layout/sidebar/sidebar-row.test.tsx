/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { RiFolderFill, RiFolderLine, RiSearchLine } from "@remixicon/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { SidebarMenuItem } from "./sidebar-menu-item"
import { SidebarRow } from "./sidebar-row"

const mocks = vi.hoisted(() => ({
  isEditing: false,
  isMobile: true,
  setOpenMobile: vi.fn(),
}))

vi.mock("@/components/ui/sidebar", () => ({
  useSidebar: () => ({ setOpenMobile: mocks.setOpenMobile }),
}))
vi.mock("@/hooks/use-breakpoint", () => ({
  useBreakpoint: () => mocks.isMobile,
}))
vi.mock("@/hooks/use-inline-rename", () => ({
  useInlineRename: () => ({
    isEditing: mocks.isEditing,
    start: vi.fn(),
    containerRef: { current: null },
    inputProps: {},
    onContainerClick: vi.fn(),
  }),
}))
vi.mock("next/link", () => ({
  default: ({
    href,
    prefetch: _prefetch,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string
    prefetch?: boolean
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

describe("SidebarRow navigation contract", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeAll(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    if (root) act(() => root?.unmount())
    container?.remove()
    container = null
    root = null
    mocks.isEditing = false
    mocks.setOpenMobile.mockReset()
  })

  function renderRow(onAction: () => void) {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    const rerender = () =>
      act(() =>
        root?.render(
          <SidebarRow
            interaction={{ kind: "link", href: "/p/project-1" }}
            isActive
            title="Project One"
            renameValue="Project One"
            renameLabel="Project title"
            onRename={vi.fn()}
            leadingIcon={RiFolderLine}
            activeLeadingIcon={RiFolderFill}
            trailing={() => (
              <button
                type="button"
                aria-label="Pin Project One"
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onAction()
                }}
              />
            )}
          />
        )
      )
    rerender()
    return rerender
  }

  it("renders a native project link without disclosure semantics and closes mobile", () => {
    const onAction = vi.fn()
    renderRow(onAction)

    const link = container?.querySelector<HTMLAnchorElement>(
      'a[href="/p/project-1"]'
    )
    const action = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Pin Project One"]'
    )

    expect(link).not.toBeNull()
    expect(link?.getAttribute("aria-current")).toBe("page")
    expect(container?.querySelector("[aria-expanded]")).toBeNull()
    expect(container?.querySelector("[aria-controls]")).toBeNull()
    expect(link?.contains(action ?? null)).toBe(false)

    link?.addEventListener("click", (event) => event.preventDefault())
    act(() =>
      link?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      )
    )
    expect(mocks.setOpenMobile).toHaveBeenCalledWith(false)

    mocks.setOpenMobile.mockClear()
    act(() => action?.click())
    expect(onAction).toHaveBeenCalledOnce()
    expect(mocks.setOpenMobile).not.toHaveBeenCalled()
  })

  it("keeps resting and rename states on the shared leading-icon slot", () => {
    const rerender = renderRow(vi.fn())
    const restingSlot = container?.querySelector(
      '[data-slot="sidebar-leading-icon"]'
    )

    expect(restingSlot).not.toBeNull()
    expect(restingSlot?.getAttribute("data-label-spacing")).toBe("true")
    expect(restingSlot?.closest("a")).not.toBeNull()
    expect(restingSlot?.querySelector('[data-slot="icon"]')).not.toBeNull()

    mocks.isEditing = true
    rerender()

    const editingSlot = container?.querySelector(
      '[data-slot="sidebar-leading-icon"]'
    )
    const input = container?.querySelector('input[aria-label="Project title"]')

    expect(editingSlot).not.toBeNull()
    expect(editingSlot?.getAttribute("data-label-spacing")).toBe("true")
    expect(editingSlot?.closest("a")).toBeNull()
    expect(editingSlot?.nextElementSibling).toBe(input)
  })

  it("shares the same leading-icon slot with sidebar menu items", () => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    act(() =>
      root?.render(<SidebarMenuItem icon={RiSearchLine} label="Search" />)
    )

    const slot = container.querySelector('[data-slot="sidebar-leading-icon"]')

    expect(slot).not.toBeNull()
    expect(slot?.getAttribute("data-label-spacing")).toBe("true")
    expect(slot?.querySelector('[data-slot="icon"]')).not.toBeNull()
  })
})
