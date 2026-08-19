/** @vitest-environment jsdom */

import { DESIGN_SYSTEM_PINNED_COMPONENTS_STORAGE_KEY } from "@/app/design-system/_lib/component-pinning"
import type { ReactNode } from "react"
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { DesignSystemSidebar } from "./design-system-sidebar"

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

vi.mock("next/navigation", () => ({
  usePathname: () => "/design-system/accordion",
}))

vi.mock("@/components/ui/sidebar", () => ({
  Sidebar: ({ children, ...props }: { children: ReactNode }) => (
    <aside {...props}>{children}</aside>
  ),
}))

vi.mock("@/components/icons/naw", () => ({
  NawIcon: () => <span aria-hidden="true" />,
}))

vi.mock("@/components/ui/collapsible-section", () => ({
  CollapsibleSection: ({
    title,
    children,
  }: {
    title: string
    children: ReactNode
  }) => (
    <section data-section={title}>
      <h2>{title}</h2>
      {children}
    </section>
  ),
}))

vi.mock("@/app/components/layout/sidebar/trailing-icon-button", () => ({
  SidebarPinAction: ({
    pinned,
    title,
    onTogglePinned,
  }: {
    pinned: boolean
    title: string
    onTogglePinned: () => void
  }) => (
    <button
      type="button"
      aria-label={`${pinned ? "Unpin" : "Pin"} ${title}`}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onTogglePinned()
      }}
    />
  ),
}))

describe("DesignSystemSidebar component pinning", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeAll(() => {
    let values = new Map<string, string>()
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        key: (index: number) => [...values.keys()][index] ?? null,
        get length() {
          return values.size
        },
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
      },
    })
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  beforeEach(() => localStorage.clear())

  afterEach(() => {
    if (root) act(() => root?.unmount())
    container?.remove()
    container = null
    root = null
  })

  function renderSidebar() {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(<DesignSystemSidebar />))
  }

  function section(title: string) {
    return container?.querySelector<HTMLElement>(`[data-section="${title}"]`)
  }

  it("moves pinned components into a persistent newest-first section", () => {
    renderSidebar()

    expect(section("Pinned")).toBeNull()
    expect(section("Primitives")?.textContent).toContain("Accordion")

    act(() =>
      container
        ?.querySelector<HTMLButtonElement>('button[aria-label="Pin Accordion"]')
        ?.click()
    )

    expect(section("Pinned")?.textContent).toContain("Accordion")
    expect(section("Primitives")?.textContent).not.toContain("Accordion")
    expect(
      localStorage.getItem(DESIGN_SYSTEM_PINNED_COMPONENTS_STORAGE_KEY)
    ).toBe('["accordion"]')

    act(() =>
      container
        ?.querySelector<HTMLButtonElement>(
          'button[aria-label="Pin Alert Dialog"]'
        )
        ?.click()
    )

    const pinnedLinks = [...(section("Pinned")?.querySelectorAll("a") ?? [])]
    expect(pinnedLinks.map((link) => link.textContent)).toEqual([
      "Alert Dialog",
      "Accordion",
    ])

    act(() =>
      container
        ?.querySelector<HTMLButtonElement>(
          'button[aria-label="Unpin Accordion"]'
        )
        ?.click()
    )

    expect(section("Pinned")?.textContent).not.toContain("Accordion")
    expect(section("Primitives")?.textContent).toContain("Accordion")
  })
})
