import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import Page from "./page"

const pageMocks = vi.hoisted(() => ({
  accessToken: "access-token",
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
  query: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT")
  }),
  setAuth: vi.fn(),
  layoutHeader: undefined as React.ReactNode,
}))

vi.mock("@/app/components/layout/layout-app", () => ({
  LayoutApp: ({
    children,
    header,
  }: {
    children: React.ReactNode
    header?: React.ReactNode
  }) => {
    pageMocks.layoutHeader = header
    return children
  },
}))
vi.mock("@/app/components/chat/chat", () => ({
  Chat: ({ project }: { project?: { id: string; name: string } }) => (
    <div data-project-id={project?.id}>{project?.name}</div>
  ),
}))
vi.mock("@/app/components/chat/chat-chrome-host", () => ({
  ChatChromeProvider: ({
    children,
    initialAppHeader,
    initialFixedHeader,
  }: {
    children: React.ReactNode
    initialAppHeader: boolean
    initialFixedHeader: string
  }) => (
    <div
      data-initial-app-header={String(initialAppHeader)}
      data-initial-fixed-header={initialFixedHeader}
    >
      {children}
    </div>
  ),
  ChatChromeHeader: () => <div data-chat-chrome-header="" />,
}))
vi.mock("@/lib/auth/workos", () => ({
  getAuthenticatedWorkosSession: () => ({
    accessToken: pageMocks.accessToken,
  }),
}))
vi.mock("@/lib/chat-store/messages/provider", () => ({
  MessagesProvider: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class MockConvexHttpClient {
    setAuth = pageMocks.setAuth
    query = pageMocks.query
  },
}))
vi.mock("next/navigation", () => ({
  notFound: pageMocks.notFound,
  redirect: pageMocks.redirect,
}))

describe("project page", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pageMocks.query.mockResolvedValue({
      _id: "project-123456",
      name: "Authorized project",
    })
    process.env.NEXT_PUBLIC_CONVEX_URL = "http://127.0.0.1:3210"
  })

  it("passes the owner-checked project view to the client component", async () => {
    const element = await Page({
      params: Promise.resolve({ projectId: "project-123456" }),
    })
    const html = renderToStaticMarkup(element)

    expect(pageMocks.setAuth).toHaveBeenCalledWith("access-token")
    expect(pageMocks.query).toHaveBeenCalledWith(expect.anything(), {
      projectId: "project-123456",
    })
    expect(html).toContain('data-project-id="project-123456"')
    expect(html).toContain("Authorized project")
    expect(html).toContain('data-initial-app-header="false"')
    expect(html).toContain('data-initial-fixed-header="less-than-xl"')
    expect(renderToStaticMarkup(pageMocks.layoutHeader)).toContain(
      "data-chat-chrome-header"
    )
  })

  it("continues to hide missing or unauthorized projects as not found", async () => {
    pageMocks.query.mockResolvedValue(null)

    await expect(
      Page({ params: Promise.resolve({ projectId: "project-123456" }) })
    ).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("does not disclose a project when the owner-checked query fails", async () => {
    pageMocks.query.mockRejectedValue(new Error("Convex unavailable"))

    await expect(
      Page({ params: Promise.resolve({ projectId: "project-123456" }) })
    ).rejects.toThrow("NEXT_NOT_FOUND")
  })
})
