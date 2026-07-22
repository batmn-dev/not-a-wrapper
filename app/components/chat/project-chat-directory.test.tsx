/** @vitest-environment jsdom */

import type { Id } from "@/convex/_generated/dataModel"
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

const directoryMocks = vi.hoisted(() => ({
  data: undefined as unknown,
  isLoading: true,
  queryError: null as Error | null,
  renameProject: vi.fn(async () => true),
  routerPush: vi.fn(),
  togglePinned: vi.fn(),
}))

vi.mock("@/lib/convex/use-per-user-query", () => ({
  usePerUserQuery: () => {
    if (directoryMocks.queryError) throw directoryMocks.queryError
    return { data: directoryMocks.data, isLoading: directoryMocks.isLoading }
  },
}))

vi.mock("next/link", () => ({
  default: ({
    children,
    prefetch,
    ...props
  }: React.ComponentProps<"a"> & { prefetch?: boolean }) => {
    void prefetch
    return <a {...props}>{children}</a>
  },
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: directoryMocks.routerPush }),
}))

vi.mock("@/app/components/layout/chat-actions-menu", () => ({
  ChatActionsMenu: ({
    trigger,
    triggerAriaLabel,
    onOpenChange,
  }: {
    trigger?: React.ReactNode
    triggerAriaLabel?: string
    onOpenChange?: (open: boolean) => void
  }) => (
    <>
      {trigger ?? (
        <button type="button" aria-label={triggerAriaLabel}>
          Options
        </button>
      )}
      <button
        type="button"
        data-testid={`toggle-${triggerAriaLabel}`}
        onClick={() => onOpenChange?.(true)}
      >
        Open mocked menu
      </button>
    </>
  ),
}))

vi.mock("@/app/components/layout/header-sidebar-trigger", () => ({
  HeaderSidebarTrigger: () => <button type="button">Open sidebar</button>,
}))

vi.mock("@/lib/user-preference-store/provider", () => ({
  useUserPreferences: () => ({ preferences: { layout: "sidebar" } }),
}))

vi.mock("@/app/components/projects/use-rename-project", () => ({
  useRenameProject: () => directoryMocks.renameProject,
}))

vi.mock("@/app/components/projects/use-project-pinning", () => ({
  useProjectPinning: () => ({
    isPinned: (project: { pinned?: boolean }) => Boolean(project.pinned),
    isPinPending: () => false,
    togglePinned: directoryMocks.togglePinned,
  }),
}))

vi.mock("@/app/components/projects/project-actions-menu", () => ({
  ProjectActionsMenu: ({
    trigger,
    onStartEditing,
    onTogglePinned,
  }: {
    trigger: React.ReactNode
    onStartEditing?: () => void
    onTogglePinned: () => void
  }) => (
    <>
      {trigger}
      {onStartEditing ? (
        <button type="button" data-menu-item="rename" onClick={onStartEditing}>
          Rename
        </button>
      ) : null}
      <button type="button" data-menu-item="pin" onClick={onTogglePinned}>
        Pin
      </button>
    </>
  ),
}))

let ProjectChatDirectory: (typeof import("./project-chat-directory"))["ProjectChatDirectory"]
let ProjectDetailSurface: (typeof import("./project-detail-surface"))["ProjectDetailSurface"]
let formatProjectConversationDate: (value: string, now?: Date) => string

beforeAll(async () => {
  ;({ ProjectChatDirectory, formatProjectConversationDate } =
    await import("./project-chat-directory"))
  ;({ ProjectDetailSurface } = await import("./project-detail-surface"))
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

function projectId(value = "project-1") {
  return value as Id<"projects">
}

function chatEntry({
  id,
  title,
  preview,
  updatedAt,
}: {
  id: string
  title: string
  preview: string | null
  updatedAt: number
}) {
  return {
    chat: {
      _id: id,
      _creationTime: updatedAt - 1,
      userId: "user-1",
      title,
      public: false,
      pinned: false,
      updatedAt,
    },
    preview,
  }
}

describe("ProjectChatDirectory", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    directoryMocks.data = undefined
    directoryMocks.isLoading = true
    directoryMocks.queryError = null
    vi.clearAllMocks()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function renderDirectory() {
    act(() => {
      root.render(<ProjectChatDirectory projectId={projectId()} />)
    })
  }

  it("renders tab semantics and moves selection with arrow keys", () => {
    directoryMocks.data = []
    directoryMocks.isLoading = false
    renderDirectory()

    const tabs = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    )
    expect(
      container.querySelector('[role="tablist"]')?.getAttribute("aria-label")
    ).toBe("Project sections")
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Chats", "Sources"])
    expect(tabs[0].getAttribute("aria-selected")).toBe("true")

    act(() => {
      tabs[0].dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
      )
    })

    expect(tabs[1].getAttribute("aria-selected")).toBe("true")
    expect(document.activeElement).toBe(tabs[1])
    expect(container.textContent).toContain("No project sources")
  })

  it("renders explicit loading and empty states", () => {
    renderDirectory()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()

    directoryMocks.data = []
    directoryMocks.isLoading = false
    act(() => root.render(<ProjectChatDirectory projectId={projectId()} />))
    expect(container.textContent).toContain("No chats in this project yet")
  })

  it("renders project titles, real previews, dates, links, and actions", () => {
    directoryMocks.data = [
      chatEntry({
        id: "chat-1",
        title: "Quarterly planning",
        preview: "Review the operating plan and identify the largest risk.",
        updatedAt: Date.UTC(2026, 6, 17, 12),
      }),
      chatEntry({
        id: "chat-2",
        title: "Untitled preview",
        preview: null,
        updatedAt: Date.UTC(2026, 5, 5, 12),
      }),
    ]
    directoryMocks.isLoading = false
    renderDirectory()

    expect(container.textContent).toContain("Quarterly planning")
    expect(container.textContent).toContain("Review the operating plan")
    expect(container.textContent).toContain("Jul 17")
    expect(container.querySelector('a[href="/c/chat-1"]')).not.toBeNull()
    expect(
      container.querySelector(
        'button[aria-label="Open conversation options for Quarterly planning"]'
      )
    ).not.toBeNull()
    const link = container.querySelector('a[href="/c/chat-1"]')
    expect(link?.getAttribute("aria-description")).toBe("Last updated Jul 17")
    expect(link?.getAttribute("aria-label")).toBeNull()
    const emptyPreviewLink = container.querySelector('a[href="/c/chat-2"]')
    expect(
      emptyPreviewLink?.querySelector('[aria-hidden="true"]')?.className
    ).toContain("mt-px")
    expect(
      emptyPreviewLink?.querySelector('[aria-hidden="true"]')?.className
    ).toContain("h-0")
    const list = container.querySelector(
      'ol[aria-label="Project conversations"]'
    )
    expect(list?.className).toContain("divide-y")

    const row = list?.querySelector("li")
    act(() => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
    })
    expect(directoryMocks.routerPush).toHaveBeenCalledWith("/c/chat-1")
    const action = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open conversation options for Quarterly planning"]'
    )
    expect(action?.className).toContain("h-10")
    expect(action?.className).toContain("w-[34px]")
    expect(action?.className).toContain("ps-1")
    expect(action?.className).toContain("pe-1.5")
    act(() => action?.click())
    expect(directoryMocks.routerPush).toHaveBeenCalledTimes(1)
    const menuToggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="toggle-Open conversation options for Quarterly planning"]'
    )
    act(() => menuToggle?.click())
    expect(row?.getAttribute("data-actions-open")).toBe("true")
    expect(row?.className).toContain("bg-interactive-hover")
    expect(
      container.querySelector('[data-testid="project-conversation-date"]')
        ?.className
    ).toContain("opacity-0")
    expect(
      container.querySelector(
        '[data-testid="project-conversation-overflow-menu"]'
      )?.className
    ).toContain("opacity-100")
    expect(
      container.querySelector('[data-testid="project-conversation-date"]')
        ?.className
    ).not.toContain("transition")
    for (const tab of container.querySelectorAll('[role="tab"]')) {
      expect(tab.className).not.toContain("transition")
      expect(tab.className).toContain("py-[9px]")
    }
    expect(
      container.querySelector('[role="tabpanel"]')?.parentElement?.className
    ).toContain("gap-4")
  })

  it("contains query failures in an intentional error state", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    directoryMocks.queryError = new Error("query failed")
    directoryMocks.isLoading = false
    renderDirectory()

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn't load chats"
    )
    consoleError.mockRestore()
  })
})

describe("project detail presentation", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    directoryMocks.data = []
    directoryMocks.isLoading = false
    directoryMocks.queryError = null
    vi.clearAllMocks()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("renders the project title, composer copy, compact header, and backed actions", async () => {
    act(() => {
      root.render(
        <ProjectDetailSurface
          project={{ id: projectId(), name: "Investing", pinned: false }}
          composer={<textarea placeholder="New chat in Investing" />}
          onStartChat={vi.fn()}
        />
      )
    })

    expect(container.textContent).toContain("Investing")
    expect(
      container.querySelector('textarea[placeholder="New chat in Investing"]')
    ).not.toBeNull()
    expect(container.textContent).toContain("Chat")
    expect(container.querySelector("header")?.className).toContain("gap-2")
    expect(
      container.querySelector('[data-testid="project-folder-icon"]')
    ).not.toBeNull()
    const surface = container.querySelector(
      '[data-project-detail-surface="true"]'
    )
    expect(surface?.className).toContain("[&_a]:transition-none")
    expect(surface?.className).toContain("[&_button]:transition-none")

    const titleButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit the title of Investing"]'
    )
    act(() => titleButton?.click())
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Project title"]'
    )
    expect(input).not.toBeNull()

    act(() => {
      if (!input) return
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set
      setter?.call(input, "Long-term investing")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    act(() => {
      if (!input) return
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      )
    })
    await act(async () => {})
    expect(directoryMocks.renameProject).toHaveBeenCalledWith(
      projectId(),
      "Long-term investing"
    )

    const pinAction = container.querySelector<HTMLButtonElement>(
      '[data-menu-item="pin"]'
    )
    act(() => pinAction?.click())
    expect(directoryMocks.togglePinned).toHaveBeenCalledWith({
      _id: projectId(),
      pinned: false,
    })
  })

  it("truncates long project titles in both responsive header structures", () => {
    const longName =
      "A deliberately long project title that must stay within the header"
    act(() => {
      root.render(
        <ProjectDetailSurface
          project={{ id: projectId(), name: longName, pinned: false }}
          composer={<textarea placeholder={`New chat in ${longName}`} />}
          onStartChat={vi.fn()}
        />
      )
    })

    expect(container.querySelector("h1")?.className).toContain("truncate")
    expect(container.querySelector("header div.truncate")?.className).toContain(
      "truncate"
    )
  })
})

describe("formatProjectConversationDate", () => {
  it("omits the current year and includes older years", () => {
    const now = new Date("2026-07-21T12:00:00Z")
    expect(formatProjectConversationDate("2026-07-17T12:00:00Z", now)).toBe(
      "Jul 17"
    )
    expect(formatProjectConversationDate("2025-02-23T12:00:00Z", now)).toBe(
      "Feb 23, 2025"
    )
  })
})
