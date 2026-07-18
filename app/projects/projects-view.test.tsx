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
vi.mock("@/hooks/use-breakpoint", () => ({
  useBreakpoint: () => false,
}))
vi.mock("@/app/components/layout/header-sidebar-trigger", () => ({
  HeaderSidebarTrigger: () => <button type="button">menu</button>,
}))
// Lean stand-ins for the base-ui shells: the dialog renders children when
// open; the row menu renders its trigger plus each item as a plain button.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
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
  // jsdom has no IntersectionObserver (toolbar stuck-sentinel).
  class IntersectionObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.IntersectionObserver =
    IntersectionObserverStub as unknown as typeof IntersectionObserver
})

describe("ProjectsView", () => {
  let container: HTMLDivElement
  let root: Root

  const render = async () => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root.render(<ProjectsView />)
    })
  }

  const click = (el: Element) =>
    el.dispatchEvent(
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

  const byText = (text: string, selector = "*") =>
    [...container.querySelectorAll(selector)].find(
      (el) => el.textContent?.trim() === text && el.children.length === 0
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

  it("renders owned projects newest-first with grid semantics and labeled actions", async () => {
    await render()

    const grid = container.querySelector('[role="grid"]')
    expect(grid?.getAttribute("aria-label")).toBe("Projects")
    const headers = [...container.querySelectorAll('[role="columnheader"]')]
    expect(headers.map((h) => h.textContent?.trim())).toEqual([
      "Name",
      "Modified",
      "Actions",
    ])
    expect(container.querySelector('[role="rowgroup"]')).toBeTruthy()

    const rows = [
      ...container.querySelectorAll<HTMLElement>(
        '[data-project-row="true"]'
      ),
    ]
    expect(rows.map((row) => row.dataset.projectId)).toEqual(["p2", "p1"])
    expect(rows.every((row) => row.tabIndex === 0)).toBe(true)
    expect(
      container.querySelector('[aria-label="Open project options for Alpha"]')
    ).toBeTruthy()
    expect(container.querySelector('[data-project-new-chat="true"]')).toBeNull()
    expect(container.querySelector('[aria-label="Pin Alpha"]')).toBeTruthy()
    expect(container.querySelector('[data-sort-column]')).toBeNull()
  })

  it("orders projects by persisted activity instead of creation time", async () => {
    mocks.perUserQuery = {
      data: [
        { ...ownedProjects[0], updatedAt: 3_000 },
        { ...ownedProjects[1], updatedAt: 2_000 },
      ],
      isLoading: false,
    }

    await render()

    const rows = [
      ...container.querySelectorAll<HTMLElement>(
        '[data-project-row="true"]'
      ),
    ]
    expect(rows.map((row) => row.dataset.projectId)).toEqual(["p1", "p2"])
  })

  it("keeps every row tabbable and traverses cells and rows with arrows", async () => {
    await render()

    const rows = [
      ...container.querySelectorAll<HTMLElement>('[data-project-row="true"]'),
    ]
    const tabbableGridTargets = [
      ...container.querySelectorAll<HTMLElement>(
        '[role="grid"] [tabindex="0"]'
      ),
    ]

    expect(tabbableGridTargets).toEqual(rows)
    rows[0].focus()
    await act(async () => {
      rows[0].dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
      )
    })
    expect(document.activeElement?.getAttribute("role")).toBe("gridcell")
    expect(document.activeElement?.textContent).toContain("Beta")

    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
      )
    })
    expect(document.activeElement?.textContent).toContain("Alpha")

    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })
      )
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })
      )
    })
    expect(document.activeElement?.getAttribute("role")).toBe("columnheader")
    expect(document.activeElement?.textContent?.trim()).toBe("Name")

    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
      )
    })
    expect(document.activeElement?.textContent).toContain("Beta")
  })

  it("navigates focused rows with Enter/Space but not from row actions", async () => {
    await render()

    const firstRow = container.querySelector<HTMLElement>(
      '[data-project-row="true"]'
    )!
    await act(async () => {
      firstRow.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        })
      )
    })
    expect(mocks.push).toHaveBeenCalledWith("/p/p2")

    mocks.push.mockClear()
    const menuTrigger = firstRow.querySelector<HTMLElement>(
      '[data-project-menu-trigger="true"]'
    )!
    await act(async () => {
      menuTrigger.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        })
      )
    })
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it("reaches row actions by keyboard and returns to the row with Escape", async () => {
    await render()

    const firstRow = container.querySelector<HTMLElement>(
      '[data-project-row="true"]'
    )!
    firstRow.focus()
    await act(async () => {
      firstRow.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
      )
    })
    expect(document.activeElement?.getAttribute("role")).toBe("gridcell")

    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
      )
    })
    expect(document.activeElement).toBe(
      firstRow.querySelectorAll('[role="gridcell"]')[1]
    )

    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
      )
    })
    expect(
      document.activeElement?.getAttribute("data-project-menu-trigger")
    ).toBe("true")

    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        })
      )
    })
    expect(document.activeElement).toBe(firstRow)
  })

  it("renders non-interactive reference headers without sorting affordances", async () => {
    await render()

    const headers = [
      ...container.querySelectorAll<HTMLElement>('[role="columnheader"]'),
    ]
    expect(headers.map((header) => header.getAttribute("aria-sort"))).toEqual([
      null,
      null,
      null,
    ])
    expect(headers.every((header) => header.tabIndex === -1)).toBe(true)
    expect(container.querySelector('[data-sort-column]')).toBeNull()
  })

  it("does not flash an empty state while the query loads", async () => {
    mocks.perUserQuery = { data: undefined, isLoading: true }
    await render()

    expect(byText("No projects yet")).toBeUndefined()
    expect(container.querySelector('[role="grid"]')).toBeNull()
  })

  it("renders the directory fallback when the per-user query throws", async () => {
    mocks.perUserQueryError = new Error("subscription failed")
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    await render()

    expect(byText("Projects couldn't load")).toBeTruthy()
    expect(
      byText("Something went wrong. Refresh the page to try again.")
    ).toBeTruthy()
    expect(container.querySelector('[role="grid"]')).toBeNull()
    consoleError.mockRestore()
  })

  it("filters projects client-side and shows the no-results state", async () => {
    await render()

    const search = container.querySelector<HTMLInputElement>(
      "#projects-page-search"
    )!
    await act(async () => setInputValue(search, "alp"))
    expect(container.querySelectorAll('[data-project-row="true"]')).toHaveLength(
      1
    )
    expect(byText("Alpha")).toBeTruthy()

    await act(async () => setInputValue(search, "zzz"))
    expect(container.querySelectorAll('[data-project-row="true"]')).toHaveLength(
      0
    )
    expect(byText("No matching projects")).toBeTruthy()
    expect(byText("Try a different search or tab.")).toBeTruthy()
    expect(container.querySelector('[data-testid="project-folder-icon"]')).toBeTruthy()
  })

  it("shows the search outline only when keyboard modality led into focus", async () => {
    await render()

    const search = container.querySelector<HTMLInputElement>(
      "#projects-page-search"
    )!
    await act(async () => {
      document.dispatchEvent(new Event("pointerdown", { bubbles: true }))
      search.focus()
    })
    expect(search.getAttribute("data-keyboard-focused")).toBeNull()

    await act(async () => {
      search.dispatchEvent(
        new KeyboardEvent("keydown", { key: "a", bubbles: true })
      )
    })
    expect(search.getAttribute("data-keyboard-focused")).toBeNull()

    await act(async () => {
      search.blur()
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true })
      )
      search.focus()
    })
    expect(search.getAttribute("data-keyboard-focused")).toBe("true")

    await act(async () => search.blur())
    expect(search.getAttribute("data-keyboard-focused")).toBeNull()
  })

  it("restores tab and search from the URL while ignoring obsolete sort state", async () => {
    mocks.searchParams = new URLSearchParams("tab=created&q=alp&sort=name-desc")
    await render()

    const rows = [
      ...container.querySelectorAll<HTMLElement>('[data-project-row="true"]'),
    ]
    expect(rows.map((row) => row.dataset.projectId)).toEqual(["p1"])
    expect(
      container.querySelector<HTMLInputElement>("#projects-page-search")?.value
    ).toBe("alp")
    expect(container.querySelector('[data-sort-column]')).toBeNull()
    expect(
      container
        .querySelector("button[aria-current='page']")
        ?.textContent?.trim()
    ).toBe("Created by you")
  })

  it("shows owned projects on All and Created by you, and an honest Shared empty state", async () => {
    await render()

    await act(async () => void click(byText("Created by you", "button")!))
    expect(container.querySelectorAll('[data-project-row="true"]')).toHaveLength(
      2
    )

    await act(async () => void click(byText("Shared with you", "button")!))
    expect(container.querySelectorAll('[data-project-row="true"]')).toHaveLength(
      0
    )
    expect(byText("No matching projects")).toBeTruthy()
    expect(byText("Try a different search or tab.")).toBeTruthy()

    await act(async () => void click(byText("All", "button")!))
    expect(container.querySelectorAll('[data-project-row="true"]')).toHaveLength(
      2
    )
  })

  it("creates a project through the existing mutation and navigates to it", async () => {
    await render()

    const newButton = [...container.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "New"
    )!
    await act(async () => void click(newButton))

    const nameInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="Project name"]'
    )!
    expect(nameInput.classList.contains("focus-visible:ring-0")).toBe(true)
    expect(nameInput.classList.contains("focus-visible:ring-3")).toBe(false)
    await act(async () => setInputValue(nameInput, "My project"))
    await act(async () => {
      nameInput
        .closest("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })

    expect(mocks.mutationCalls).toContainEqual({
      name: "projects:create",
      args: { name: "My project" },
    })
    expect(mocks.push).toHaveBeenCalledWith("/p/new-project-id")
  })

  it("omits the non-reference Rename action from directory menus", async () => {
    await render()

    expect(container.querySelector('[data-menu-item="rename"]')).toBeNull()
  })

  it("deletes only after confirmation via the existing mutation", async () => {
    await render()

    const firstRow = container.querySelector('[data-project-row="true"]')!
    const deleteItem = firstRow.querySelector('[data-menu-item="delete"]')!
    await act(async () => void click(deleteItem))
    expect(mocks.mutationCalls).toHaveLength(0)

    const confirm = [...container.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Delete Project"
    )!
    await act(async () => void click(confirm))

    expect(mocks.mutationCalls).toContainEqual({
      name: "projects:remove",
      args: { projectId: "p2" },
    })
  })

  it("keeps action clicks from triggering row navigation", async () => {
    await render()

    const trigger = container.querySelector(
      '[aria-label="Open project options for Beta"]'
    )!
    let navigationDefaultAllowed = true
    await act(async () => {
      navigationDefaultAllowed = trigger.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      )
    })
    // preventDefault ran, so the enclosing row anchor cannot navigate.
    expect(navigationDefaultAllowed).toBe(false)
  })

  it("clears search, restores input focus, and exposes no new-chat action", async () => {
    await render()

    const search = container.querySelector<HTMLInputElement>(
      "#projects-page-search"
    )!
    await act(async () => setInputValue(search, "beta"))
    const clear = container.querySelector<HTMLButtonElement>(
      '[aria-label="Clear search"]'
    )!
    expect(clear).toBeTruthy()
    clear.focus()
    await act(async () => void click(clear))
    expect(search.value).toBe("")
    expect(document.activeElement).toBe(search)
    expect(container.querySelector('[data-project-new-chat="true"]')).toBeNull()
  })

  it("pins optimistically, sorts pinned first, and calls the owned mutation", async () => {
    await render()

    const alphaRow = container.querySelector<HTMLElement>(
      '[data-project-id="p1"]'
    )!
    const pinItem = alphaRow.querySelector('[data-menu-item="pin"]')!
    await act(async () => {
      click(pinItem)
      await Promise.resolve()
    })

    expect(mocks.mutationCalls).toContainEqual({
      name: "projects:togglePinned",
      args: { projectId: "p1", pinned: true },
    })
    expect(
      container.querySelector<HTMLElement>('[data-project-row="true"]')?.dataset
        .projectId
    ).toBe("p1")
    expect(
      container.querySelector('[data-project-id="p1"] [title="Pinned"]')
    ).toBeTruthy()
    expect(
      container
        .querySelector('[data-project-id="p1"] [data-testid="project-row-pin"]')
        ?.closest('[data-page-table-row-actions="true"]')
    ).toBeTruthy()
    expect(
      container.querySelector(
        '[data-project-id="p1"] [role="gridcell"]:first-child [title="Pinned"]'
      )
    ).toBeNull()
    expect(
      container.querySelector('[data-project-id="p1"] [data-menu-item="pin"]')
        ?.textContent
    ).toBe("Unpin project")
  })

  it("rolls pinning back and shows a failure toast when the mutation rejects", async () => {
    mocks.rejectedMutations.add("projects:togglePinned")
    await render()

    const pinItem = container.querySelector(
      '[data-project-id="p1"] [data-menu-item="pin"]'
    )!
    await act(async () => {
      click(pinItem)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(
      container.querySelector<HTMLElement>('[data-project-row="true"]')?.dataset
        .projectId
    ).toBe("p2")
    expect(
      container.querySelector('[data-project-id="p1"] [title="Pinned"]')
    ).toBeNull()
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Failed to update project pin",
      status: "error",
    })
  })

  it("exposes the desktop-reveal / touch-persistent action visibility contract", async () => {
    await render()

    const actions = container.querySelector(
      '[data-testid="project-row-actions"]'
    )!
    expect(actions.className).toContain("opacity-0")
    expect(actions.className).toContain("group-hover/project-row:opacity-100")
    expect(actions.className).toContain(
      "group-focus-within/project-row:opacity-100"
    )
    expect(actions.className).toContain("max-sm:opacity-100")
    expect(actions.className).toContain("pointer-coarse:opacity-100")
  })
})
