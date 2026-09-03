/** @vitest-environment jsdom */

import type { FunctionReference } from "convex/server"
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
import { usePerUserQuery } from "./use-per-user-query"

const convexMocks = vi.hoisted(() => ({
  isAuthenticated: false,
  isAuthLoading: false,
  queryValue: undefined as string | undefined,
  useQuery: vi.fn(),
}))

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({
    isAuthenticated: convexMocks.isAuthenticated,
    isLoading: convexMocks.isAuthLoading,
  }),
  usePaginatedQuery: vi.fn(),
}))
// The seam's useQuery is the convex-helpers cached variant (ADR-0031).
vi.mock("convex-helpers/react/cache", () => ({
  useQuery: (...args: unknown[]) => {
    convexMocks.useQuery(...args)
    return convexMocks.queryValue
  },
}))

type TestQuery = FunctionReference<"query", "public", { id: string }, string>

const testQuery = "test:get" as unknown as TestQuery

function QuerySnapshot({ args }: { args: { id: string } | "skip" }) {
  const result = usePerUserQuery(testQuery, args)

  return (
    <div
      data-auth-ready={String(result.isAuthReady)}
      data-data={result.data ?? ""}
      data-loading={String(result.isLoading)}
    />
  )
}

describe("usePerUserQuery", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeAll(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  beforeEach(() => {
    convexMocks.isAuthenticated = false
    convexMocks.isAuthLoading = false
    convexMocks.queryValue = undefined
    convexMocks.useQuery.mockClear()
  })

  afterEach(() => {
    const mountedRoot = root
    if (mountedRoot) {
      act(() => mountedRoot.unmount())
    }
    container?.remove()
    root = null
    container = null
  })

  function renderQuery(args: { id: string } | "skip") {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(<QuerySnapshot args={args} />)
    })

    const snapshot = container.firstElementChild as HTMLDivElement | null
    if (!snapshot) {
      throw new Error("Query snapshot did not render")
    }
    return snapshot
  }

  it("does not report loading while auth resolves when the caller skipped", () => {
    convexMocks.isAuthLoading = true

    const snapshot = renderQuery("skip")

    expect(snapshot.dataset.loading).toBe("false")
    expect(convexMocks.useQuery).toHaveBeenCalledWith(testQuery, "skip")
  })

  it("reports loading while auth resolves for an active caller query", () => {
    convexMocks.isAuthLoading = true

    const snapshot = renderQuery({ id: "chat-1" })

    expect(snapshot.dataset.loading).toBe("true")
    expect(convexMocks.useQuery).toHaveBeenCalledWith(testQuery, "skip")
  })

  it("reports loading while an authenticated query is pending", () => {
    convexMocks.isAuthenticated = true

    const snapshot = renderQuery({ id: "chat-1" })

    expect(snapshot.dataset.authReady).toBe("true")
    expect(snapshot.dataset.loading).toBe("true")
    expect(convexMocks.useQuery).toHaveBeenCalledWith(testQuery, {
      id: "chat-1",
    })
  })
})
