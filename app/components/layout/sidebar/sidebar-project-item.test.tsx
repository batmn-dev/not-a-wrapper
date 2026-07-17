// @vitest-environment jsdom

import type { Id } from "@/convex/_generated/dataModel"
import type { Chat } from "@/lib/chat-store/types"
import { act, createElement } from "react"
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
import { SidebarProjectItem } from "./sidebar-project-item"

const mocks = vi.hoisted(() => ({
  pathname: "/projects",
  setOpenMobile: vi.fn(),
}))

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) =>
    createElement("a", props, children),
}))
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }))
vi.mock("@/components/ui/sidebar", () => ({
  useSidebar: () => ({ setOpenMobile: mocks.setOpenMobile }),
}))
vi.mock("@/hooks/use-breakpoint", () => ({ useBreakpoint: () => false }))
vi.mock("@/hooks/use-inline-rename", () => ({
  useInlineRename: () => ({
    isEditing: false,
    start: vi.fn(),
    containerRef: { current: null },
    inputProps: {},
    onContainerClick: vi.fn(),
  }),
}))
vi.mock("@/app/components/projects/use-rename-project", () => ({
  useRenameProject: () => vi.fn(),
}))
vi.mock("./sidebar-project-actions-menu", () => ({
  SidebarProjectActionsMenu: ({ project }: { project: { name: string } }) => (
    <button
      type="button"
      aria-label={`Open project options for ${project.name}`}
    />
  ),
}))
vi.mock("./sidebar-item", () => ({
  SidebarItem: ({
    chat,
    presentation,
  }: {
    chat: Chat
    presentation: { kind: string; projectName?: string }
  }) => (
    <div
      data-chat-row={chat.id}
      data-presentation={presentation.kind}
      data-project-name={presentation.projectName}
    />
  ),
}))

function project(id: string) {
  return {
    _id: id as Id<"projects">,
    name: "Taxes",
    pinned: false,
  }
}

function chat(id: string): Chat {
  return {
    id,
    user_id: "user",
    title: id,
    model: null,
    project_id: "project-1",
    public: false,
    pinned: false,
    pinned_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
  }
}

describe("SidebarProjectItem", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    mocks.pathname = "/projects"
    mocks.setOpenMobile.mockClear()
    localStorage.clear()
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it("uses a disclosure primary control with separate home and overflow actions", async () => {
    await act(async () => {
      root.render(
        <SidebarProjectItem
          project={project("project-1")}
          preview={{ chats: [chat("chat-1")], hasMore: true }}
          currentChatId=""
          onTogglePinned={vi.fn()}
        />
      )
    })

    const disclosure = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Taxes, project"]'
    )
    const disclosureId = "sidebar-project-project-1-chats"
    expect(disclosure?.getAttribute("aria-expanded")).toBe("false")
    expect(disclosure?.getAttribute("aria-controls")).toBe(disclosureId)
    expect(
      disclosure?.parentElement?.classList.contains("sidebar-menu-row")
    ).toBe(true)
    expect(container.querySelector(`a[href="/p/project-1"]`)).not.toBeNull()
    expect(
      container.querySelector('a[aria-label="Open project home"]')
    ).not.toBeNull()
    expect(
      container.querySelector(
        'button[aria-label="Open project options for Taxes"]'
      )
    ).not.toBeNull()
    const rail = container.querySelector('[data-sidebar-row-actions="overlay"]')
    expect(
      rail?.querySelectorAll(":scope > .sidebar-row-action-slot")
    ).toHaveLength(2)
    expect(container.querySelector(`#${disclosureId}`)).toBeNull()

    await act(async () => disclosure?.click())

    expect(disclosure?.getAttribute("aria-expanded")).toBe("true")
    expect(container.querySelector(`#${disclosureId}`)).not.toBeNull()
    expect(
      container
        .querySelector('[data-chat-row="chat-1"]')
        ?.getAttribute("data-presentation")
    ).toBe("nested")
    expect(container.textContent).toContain("Show more")
  })

  it("forces an out-of-preview active project chat open without styling the project active", async () => {
    mocks.pathname = "/c/older-chat"
    await act(async () => {
      root.render(
        <SidebarProjectItem
          project={project("project-1")}
          preview={{ chats: [chat("preview-chat")], hasMore: true }}
          currentChatId="older-chat"
          activeProjectId="project-1"
          onTogglePinned={vi.fn()}
        />
      )
    })

    const disclosure = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Taxes, project"]'
    )
    expect(disclosure?.getAttribute("aria-expanded")).toBe("true")
    expect(disclosure?.hasAttribute("data-active")).toBe(false)
    expect(
      container.querySelector('[data-chat-row="preview-chat"]')
    ).not.toBeNull()
  })
})
beforeAll(() => {
  const values = new Map<string, string>()
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  })
})
