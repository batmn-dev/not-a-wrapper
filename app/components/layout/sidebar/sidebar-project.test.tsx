// @vitest-environment jsdom

import type { Doc, Id } from "@/convex/_generated/dataModel"
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SidebarProjectModel } from "./sidebar-composition"
import { SidebarProject } from "./sidebar-project"

const mocks = vi.hoisted(() => ({
  pathname: "/projects",
  setOpenMobile: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}))

vi.mock("@/components/ui/sidebar", () => ({
  useSidebar: () => ({ setOpenMobile: mocks.setOpenMobile }),
}))

vi.mock("@/app/components/projects/dialog-create-project", () => ({
  DialogCreateProject: () => null,
}))

vi.mock("@/components/ui/collapsible-section", () => ({
  CollapsibleSection: ({
    title,
    children,
    headerActions,
  }: {
    title: string
    children: ReactNode
    headerActions: ReactNode
  }) => (
    <section aria-label={title}>
      <h2>{title}</h2>
      {headerActions}
      {children}
    </section>
  ),
}))

vi.mock("./sidebar-list", () => ({
  SidebarChatGroupActions: () => (
    <button type="button" aria-label="Organize chats" />
  ),
}))

vi.mock("./sidebar-menu-item", () => ({
  SidebarMenuItem: ({
    label,
    href,
    isActive,
    onClick,
  }: {
    label: string
    href: string
    isActive: boolean
    onClick: () => void
  }) => (
    <a
      href={href}
      aria-current={isActive ? "page" : undefined}
      onClick={(event) => {
        event.preventDefault()
        onClick()
      }}
    >
      {label}
    </a>
  ),
}))

vi.mock("./sidebar-project-item", () => ({
  SidebarProjectItem: ({ project }: { project: SidebarProjectModel }) => (
    <div data-project-row={project._id}>{project.name}</div>
  ),
}))

function project(id: string): SidebarProjectModel {
  return {
    _id: id as Id<"projects">,
    _creationTime: 1,
    userId: "user" as Id<"users">,
    name: id,
    pinned: false,
  } as Doc<"projects"> & { pinned: boolean }
}

describe("SidebarProject grouping structure", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    mocks.setOpenMobile.mockClear()
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  const commonProps = {
    isAuthenticated: true,
    projects: [project("alpha"), project("beta")],
    projectPreviews: new Map(),
    currentChatId: "",
    isPinPending: () => false,
    onTogglePinned: vi.fn(),
    onOrganizationChange: vi.fn(),
  }

  it("renders only the Projects directory row in In one list", async () => {
    await act(async () => {
      root.render(<SidebarProject {...commonProps} organization="one-list" />)
    })

    const directory = container.querySelector<HTMLAnchorElement>(
      'a[href="/projects"]'
    )
    expect(directory?.getAttribute("aria-current")).toBe("page")
    expect(container.querySelectorAll("[data-project-row]")).toHaveLength(0)

    await act(async () => directory?.click())
    expect(mocks.setOpenMobile).toHaveBeenCalledWith(false)
  })

  it("renders projects inside a Projects section in By project", async () => {
    await act(async () => {
      root.render(<SidebarProject {...commonProps} organization="by-project" />)
    })

    expect(container.querySelector('a[href="/projects"]')).toBeNull()
    expect(
      container.querySelector('section[aria-label="Projects"]')
    ).not.toBeNull()
    expect(
      [...container.querySelectorAll<HTMLElement>("[data-project-row]")].map(
        (row) => row.dataset.projectRow
      )
    ).toEqual(["alpha", "beta"])
  })
})
