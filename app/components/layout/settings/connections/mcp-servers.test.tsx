/** @vitest-environment jsdom */

import { usePerUserQuery } from "@/lib/convex/use-per-user-query"
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
import { McpServers } from "./mcp-servers"

vi.mock("@/convex/_generated/api", () => ({
  api: {
    mcpServers: {
      list: "mcpServers:list",
      remove: "mcpServers:remove",
      toggleEnabled: "mcpServers:toggleEnabled",
    },
  },
}))

vi.mock("@/lib/convex/use-per-user-query", () => ({
  usePerUserQuery: vi.fn(),
}))

vi.mock("convex/react", () => ({
  useMutation: vi.fn(() => vi.fn()),
}))

vi.mock("./mcp-server-form", () => ({
  McpServerForm: () => null,
}))

vi.mock("./mcp-tool-approvals", () => ({
  McpToolApprovals: () => null,
}))

const mockUsePerUserQuery = usePerUserQuery as unknown as ReturnType<
  typeof vi.fn
>

type McpServerListItem = {
  _id: string
  name: string
  url: string
  enabled: boolean
  lastError?: string
  lastConnectedAt?: number
}

type QueryResult = {
  data: McpServerListItem[] | undefined
  isAuthReady: boolean
  isLoading: boolean
}

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

describe("McpServers", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  function cleanupRender() {
    const rootToUnmount = root
    if (rootToUnmount) {
      act(() => rootToUnmount.unmount())
    }
    container?.remove()
    root = null
    container = null
  }

  function renderPanel(queryResult: QueryResult) {
    cleanupRender()
    mockUsePerUserQuery.mockReturnValue(queryResult)

    const mounted = document.createElement("div")
    document.body.appendChild(mounted)
    container = mounted
    root = createRoot(mounted)

    act(() => {
      root?.render(<McpServers />)
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(cleanupRender)

  function queryLoadingSkeleton() {
    return container?.querySelector(
      '[role="status"][aria-label="Loading connections"]'
    )
  }

  it("shows the loading skeleton instead of the empty state while the list is loading", () => {
    renderPanel({
      data: undefined,
      isAuthReady: true,
      isLoading: true,
    })

    expect(queryLoadingSkeleton()).toBeTruthy()
    expect(container?.textContent).not.toContain("No MCP servers configured")
  })

  it("shows the empty state after an empty list resolves", () => {
    renderPanel({
      data: [],
      isAuthReady: true,
      isLoading: false,
    })

    expect(container?.textContent).toContain("No MCP servers configured")
    expect(queryLoadingSkeleton()).toBeFalsy()
  })

  it("shows resolved MCP servers", () => {
    renderPanel({
      data: [
        {
          _id: "server_1",
          enabled: true,
          name: "Filesystem tools",
          url: "https://mcp.example.com/mcp",
        },
      ],
      isAuthReady: true,
      isLoading: false,
    })

    expect(container?.textContent).toContain("Filesystem tools")
    expect(container?.textContent).not.toContain("No MCP servers configured")
    expect(queryLoadingSkeleton()).toBeFalsy()
  })
})
