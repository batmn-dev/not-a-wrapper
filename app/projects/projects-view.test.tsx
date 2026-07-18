/** @vitest-environment jsdom */

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
import { ProjectsView } from "./projects-view"

type PerUserQueryState = {
  data: unknown
  isLoading: boolean
}

const mocks = vi.hoisted(() => ({
  perUserQuery: { data: undefined, isLoading: true } as PerUserQueryState,
  perUserQueryError: null as Error | null,
  mutationCalls: [] as Array<{ name: string; args: unknown }>,
  rejectedMutations: new Set<string>(),
  push: vi.fn(),
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
  toast: vi.fn(),
}))

vi.mock("@/lib/convex/use-per-user-query", () => ({
  usePerUserQuery: () => {
    if (mocks.perUserQueryError) throw mocks.perUserQueryError
    return mocks.perUserQuery
  },
}))
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server")
  return {
    useMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref)
      return async (args: unknown) => {
        mocks.mutationCalls.push({ name, args })
        if (mocks.rejectedMutations.has(name)) {
          throw new Error(`${name} failed`)
        }
        return "new-project-id"
      }
    },
  }
})
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  usePathname: () => "/projects",
  useSearchParams: () => mocks.searchParams,
}))
vi.mock("@/components/ui/toast", () => ({ toast: mocks.toast }))
vi.mock("@/lib/user-preference-store/provider", () => ({
  useUserPreferences: () => ({ preferences: { layout: "sidebar" } }),
}))
vi.mock("@/components/ui/scroll-root", () => ({
  useScrollRoot: () => ({ scrollRef: { current: null } }),
}))
vi.mock("@/hooks/use-breakpoint", () => ({ useBreakpoint: () => false }))
vi.mock("@/app/components/layout/header-sidebar-trigger", () => ({
  HeaderSidebarTrigger: () => <button type="button">menu</button>,
}))
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))
vi.mock("@/app/components/layout/row-actions-menu", () => ({
  RowActionsMenu: ({
    items,
    trigger,
    triggerAriaLabel,
    onOpenChange,
  }: {
    items: Array<{
      key: string
      label: string
      ariaLabel?: string
      onSelect: () => void
    }>
    trigger?: React.ReactElement<{
      onClick?: (event: React.MouseEvent) => void
    }>
    triggerAriaLabel?: string
    onOpenChange?: (open: boolean) => void
  }) => (
    <div>
      {trigger ? (
        React.cloneElement(trigger, {
          onClick: (event: React.MouseEvent) => {
            trigger.props.onClick?.(event)
            onOpenChange?.(true)
          },
        })
      ) : (
        <button
          type="button"
          aria-label={triggerAriaLabel}
          onClick={() => onOpenChange?.(true)}
        />
      )}
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          data-menu-item={item.key}
          aria-label={item.ariaLabel}
          onClick={item.onSelect}
        >
          {item.label}
        </button>
      ))}
    </div>
  ),
}))

const ownedProjects = [
  { _id: "p1", name: "Alpha", _creationTime: 1_000 },
  { _id: "p2", name: "Beta", _creationTime: 2_000 },
]

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  class IntersectionObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.IntersectionObserver =
    IntersectionObserverStub as unknown as typeof IntersectionObserver
})

describe("ProjectsView essential behavior", () => {
  let container: HTMLDivElement
  let root: Root

  const render = async () => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(<ProjectsView />))
  }

  const click = (element: Element) =>
    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true })
    )

  const setInputValue = (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  }

  const leafWithText = (text: string, selector = "*") =>
    [...container.querySelectorAll(selector)].find(
      (element) =>
        element.textContent?.trim() === text && element.children.length === 0
    )

  beforeEach(() => {
    mocks.perUserQuery = { data: ownedProjects, isLoading: false }
    mocks.perUserQueryError = null
    mocks.mutationCalls = []
    mocks.rejectedMutations.clear()
    mocks.searchParams = new URLSearchParams()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it("restores URL filters and orders projects by persisted activity", async () => {
    mocks.searchParams = new URLSearchParams(
      "tab=created&q=a&sort=name-desc"
    )
    mocks.perUserQuery = {
      data: [
        { ...ownedProjects[0], updatedAt: 3_000 },
        { ...ownedProjects[1], updatedAt: 2_000 },
      ],
      isLoading: false,
    }
    await render()

    const rows = [
      ...container.querySelectorAll<HTMLElement>('[data-project-row="true"]'),
    ]
    expect(rows.map((row) => row.dataset.projectId)).toEqual(["p1", "p2"])
    expect(
      container.querySelector<HTMLInputElement>("#projects-page-search")
        ?.value
    ).toBe("a")
    expect(
      container.querySelector("button[aria-current='page']")?.textContent
    ).toContain("Created by you")

    const search = container.querySelector<HTMLInputElement>(
      "#projects-page-search"
    )!
    await act(async () => setInputValue(search, "zzz"))
    expect(container.querySelector('[data-project-row="true"]')).toBeNull()
    expect(leafWithText("No matching projects")).toBeTruthy()
    expect(mocks.replace).toHaveBeenCalledWith(
      "/projects?tab=created&q=zzz",
      { scroll: false }
    )
  })

  it("keeps the project grid keyboard-navigable without action keys navigating", async () => {
    await render()

    const rows = [
      ...container.querySelectorAll<HTMLElement>('[data-project-row="true"]'),
    ]
    rows[0]?.focus()
    await act(async () => {
      rows[0]?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
      )
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
      )
    })
    expect(document.activeElement?.textContent).toContain("Alpha")

    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
      rows[1]?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        })
      )
    })
    expect(mocks.push).toHaveBeenCalledWith("/p/p1")

    mocks.push.mockClear()
    const action = rows[1]?.querySelector<HTMLElement>(
      '[data-project-menu-trigger="true"]'
    )
    await act(async () => {
      action?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        })
      )
    })
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it("contains query failures without unmounting the projects surface", async () => {
    mocks.perUserQueryError = new Error("subscription failed")
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    await render()

    expect(leafWithText("Projects couldn't load")).toBeTruthy()
    expect(
      leafWithText("Something went wrong. Refresh the page to try again.")
    ).toBeTruthy()
    expect(container.querySelector('[role="grid"]')).toBeNull()
    consoleError.mockRestore()
  })

  it("creates and deletes projects through the existing mutation boundaries", async () => {
    await render()

    const newButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "New"
    )!
    await act(async () => void click(newButton))
    const nameInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="Project name"]'
    )!
    await act(async () => setInputValue(nameInput, "My project"))
    await act(async () => {
      nameInput
        .closest("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })

    expect(mocks.mutationCalls).toContainEqual({
      name: "projects:create",
      args: { name: "My project" },
    })
    expect(mocks.push).toHaveBeenCalledWith("/p/new-project-id")

    const firstRow = container.querySelector('[data-project-row="true"]')!
    await act(async () => void click(firstRow.querySelector('[data-menu-item="delete"]')!))
    expect(
      mocks.mutationCalls.some(({ name }) => name === "projects:remove")
    ).toBe(false)
    const confirm = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Delete Project"
    )!
    await act(async () => void click(confirm))
    expect(mocks.mutationCalls).toContainEqual({
      name: "projects:remove",
      args: { projectId: "p2" },
    })
  })

  it("keeps optimistic pinning responsive and rolls failed writes back", async () => {
    await render()

    await act(async () => {
      click(
        container.querySelector(
          '[data-project-id="p1"] [data-menu-item="pin"]'
        )!
      )
      await Promise.resolve()
    })
    expect(
      container.querySelector<HTMLElement>('[data-project-row="true"]')
        ?.dataset.projectId
    ).toBe("p1")
    expect(mocks.mutationCalls).toContainEqual({
      name: "projects:togglePinned",
      args: { projectId: "p1", pinned: true },
    })

    mocks.rejectedMutations.add("projects:togglePinned")
    await act(async () => {
      click(
        container.querySelector(
          '[data-project-id="p2"] [data-menu-item="pin"]'
        )!
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(
      container.querySelector('[data-project-id="p2"] [title="Pinned"]')
    ).toBeNull()
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Failed to update project pin",
      status: "error",
    })
  })
})
