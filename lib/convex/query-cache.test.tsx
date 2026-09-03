/** @vitest-environment jsdom */

import { ConvexProvider, type ConvexReactClient } from "convex/react"
import { makeFunctionReference } from "convex/server"
import React, { act, useEffect } from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest"
import {
  ConvexQueryCache,
  QUERY_CACHE_IDLE_TTL_MS,
  useWarmPerUserQuery,
} from "./query-cache"
import { usePerUserQuery } from "./use-per-user-query"

// Only the seam's auth gate is mocked; the real convex-helpers cache and the
// real core `useQueries` run against a fake client whose `watchQuery` counts
// subscriptions and serves a delivered local result.
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
}))

/** One entry per `onUpdate` — each is a subscription the fake client opened. */
const subscriptions: Array<{ unsubscribe: Mock<() => void>; open: boolean }> =
  []
const fakeClient = {
  watchQuery: () => ({
    // A local value exists only while some subscription holds the query
    // open, like a real client: a cold consumer's own subscription starts
    // after its first commit, so only a warmed entry can serve that commit.
    localQueryResult: () =>
      subscriptions.some((entry) => entry.open) ? "delivered" : undefined,
    onUpdate: () => {
      const entry = { unsubscribe: vi.fn(), open: true }
      entry.unsubscribe.mockImplementation(() => {
        entry.open = false
      })
      subscriptions.push(entry)
      return entry.unsubscribe
    },
    journal: () => undefined,
  }),
} as unknown as ConvexReactClient

const testQuery = makeFunctionReference<"query", { chatId: string }, string>(
  "messages:getSelectedPath"
)

let warm: ReturnType<typeof useWarmPerUserQuery> | undefined
function Warmer() {
  const warmQuery = useWarmPerUserQuery()
  useEffect(() => {
    warm = warmQuery
  }, [warmQuery])
  return null
}

/** The value each Consumer commit rendered, in order. */
const commits: string[] = []
function Consumer() {
  const { data } = usePerUserQuery(testQuery, { chatId: "c1" })
  useEffect(() => {
    commits.push(data ?? "")
  })
  return null
}

describe("warm client query cache", () => {
  let container: HTMLDivElement
  let root: Root

  beforeAll(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
    subscriptions.length = 0
    commits.length = 0
  })

  function render(withConsumer: boolean) {
    act(() => {
      root.render(
        <ConvexProvider client={fakeClient}>
          <ConvexQueryCache>
            <Warmer />
            {withConsumer ? <Consumer /> : null}
          </ConvexQueryCache>
        </ConvexProvider>
      )
    })
  }

  it("shares one subscription between a warm and its consumer, parked for the idle TTL after unmount", () => {
    vi.useFakeTimers()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    render(false)
    act(() => warm?.(testQuery, { chatId: "c1" }))
    expect(subscriptions).toHaveLength(1)

    // The consumer joins the warmed entry (same key, so the cache opens no
    // second watch; the one extra subscription is the core hook's own) and
    // renders delivered data on its FIRST commit.
    render(true)
    expect(subscriptions).toHaveLength(2)
    expect(commits[0]).toBe("delivered")

    // Leaving parks the cache's subscription; only the TTL releases it.
    render(false)
    expect(subscriptions[0].unsubscribe).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(QUERY_CACHE_IDLE_TTL_MS - 1)
    })
    expect(subscriptions[0].unsubscribe).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(subscriptions[0].unsubscribe).toHaveBeenCalledTimes(1)

    // Cold: with nothing parked, the same consumer's first commit is empty.
    commits.length = 0
    render(true)
    expect(commits[0]).toBe("")
  })
})
