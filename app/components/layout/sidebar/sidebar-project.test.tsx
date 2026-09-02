/** @vitest-environment jsdom */

import type { Doc } from "@/convex/_generated/dataModel"
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import type { SidebarProjectModel } from "./sidebar-composition"
import { SidebarProject } from "./sidebar-project"

vi.mock("@/app/components/projects/dialog-create-project", () => ({
  DialogCreateProject: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="create-project-dialog" /> : null,
}))
vi.mock("@/components/ui/collapsible-section", () => ({
  CollapsibleSection: ({
    children,
    title,
  }: {
    children: React.ReactNode
    title: string
  }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
}))
vi.mock("@/components/ui/sidebar", () => ({
  useSidebar: () => ({ setOpenMobile: vi.fn() }),
}))
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}))
vi.mock("./sidebar-list", () => ({
  SidebarChatGroupActions: () => null,
}))
vi.mock("./sidebar-project-item", () => ({
  SidebarProjectItem: ({ project }: { project: SidebarProjectModel }) => (
    <div data-testid="existing-project">{project.name}</div>
  ),
}))

function project(): SidebarProjectModel {
  return {
    _id: "project-1",
    _creationTime: 1,
    userId: "user-1",
    name: "Existing project",
    updatedAt: 1,
    pinned: false,
  } as unknown as Doc<"projects">
}

describe("SidebarProject empty state", () => {
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
    container = null
    root = null
  })

  function render(projects: SidebarProjectModel[]) {
    if (!container) {
      container = document.createElement("div")
      document.body.appendChild(container)
      root = createRoot(container)
    }

    act(() =>
      root?.render(
        <SidebarProject
          isAuthenticated
          organization="by-project"
          projects={projects}
          isPinPending={() => false}
          onTogglePinned={vi.fn()}
          onOrganizationChange={vi.fn()}
        />
      )
    )
  }

  it("offers project creation as a menu item only while the section is empty", () => {
    render([])

    const newProject = container?.querySelector<HTMLButtonElement>(
      '[data-testid="sidebar-new-project"]'
    )

    expect(newProject?.textContent).toContain("New project")
    expect(
      newProject?.querySelector('[data-slot="sidebar-leading-icon"] svg')
    ).not.toBeNull()
    expect(
      container?.querySelector("[data-testid='create-project-dialog']")
    ).toBeNull()

    act(() => newProject?.click())

    expect(
      container?.querySelector("[data-testid='create-project-dialog']")
    ).not.toBeNull()

    render([project()])

    expect(
      container?.querySelector('[data-testid="sidebar-new-project"]')
    ).toBeNull()
    expect(
      container?.querySelector('[data-testid="existing-project"]')?.textContent
    ).toBe("Existing project")
  })
})
