import { describe, expect, it } from "vitest"
import type { Chats } from "../types"
import {
  applyOptimisticOps,
  deriveSidebarLoading,
  partitionSidebarChats,
  type OptimisticOperation,
} from "./sidebar-window"

function makeChat(overrides: Partial<Chats> & Pick<Chats, "id">): Chats {
  return {
    user_id: "user-1",
    title: overrides.id,
    model: null,
    system_prompt: null,
    project_id: null,
    public: false,
    pinned: false,
    pinned_at: null,
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("partitionSidebarChats (pinned / non-pinned partition)", () => {
  it("never puts a chat in both sections, and drops project chats", () => {
    const chats = [
      makeChat({ id: "a" }),
      makeChat({ id: "b", pinned: true, pinned_at: "2026-06-02T00:00:00.000Z" }),
      makeChat({ id: "c", project_id: "p1" }),
      makeChat({ id: "d", pinned: true, pinned_at: "2026-06-03T00:00:00.000Z" }),
    ]

    const { pinned, nonPinned } = partitionSidebarChats(chats)

    expect(pinned.map((c) => c.id)).toEqual(["d", "b"]) // newest pin first
    expect(nonPinned.map((c) => c.id)).toEqual(["a"])

    // No intersection between the two sections.
    const pinnedIds = new Set(pinned.map((c) => c.id))
    expect(nonPinned.some((c) => pinnedIds.has(c.id))).toBe(false)
  })
})

describe("applyOptimisticOps (optimistic ops × bounded window)", () => {
  it("prepends an optimistic add to the window", () => {
    const window = [makeChat({ id: "in-window" })]
    const ops: OptimisticOperation[] = [
      {
        type: "add",
        chat: makeChat({ id: "new", updated_at: "2026-06-10T00:00:00.000Z" }),
      },
    ]

    const result = applyOptimisticOps(window, ops)

    expect(result.map((c) => c.id)).toEqual(["new", "in-window"])
  })

  it("applies an in-window update", () => {
    const window = [makeChat({ id: "in-window", title: "Old" })]
    const ops: OptimisticOperation[] = [
      { type: "update", id: "in-window", changes: { title: "New" } },
    ]

    expect(applyOptimisticOps(window, ops)[0].title).toBe("New")
  })

  it("is a no-op for an update/delete targeting an out-of-window chat", () => {
    const window = [makeChat({ id: "in-window" })]
    const ops: OptimisticOperation[] = [
      { type: "update", id: "out-of-window", changes: { title: "X" } },
      { type: "delete", id: "also-out-of-window" },
    ]

    const result = applyOptimisticOps(window, ops)

    expect(result.map((c) => c.id)).toEqual(["in-window"])
    expect(result[0].title).toBe("in-window")
  })
})

describe("deriveSidebarLoading (isLoading = first page ready)", () => {
  const base = {
    isConvexAuthLoading: false,
    isConvexAuthenticated: true,
    shouldUseLocalChats: false,
    cachedChatsHydrated: true,
  }

  it("is loading while the first window page is pending, ready once it arrives", () => {
    expect(
      deriveSidebarLoading({
        ...base,
        paginated: true,
        fullListPending: false,
        firstPagePending: true,
      })
    ).toBe(true)

    expect(
      deriveSidebarLoading({
        ...base,
        paginated: true,
        fullListPending: false,
        firstPagePending: false,
      })
    ).toBe(false)
  })

  it("ignores full-list pending when paginated (the window, not all chats)", () => {
    expect(
      deriveSidebarLoading({
        ...base,
        paginated: true,
        fullListPending: true, // legacy signal must not keep it loading
        firstPagePending: false,
      })
    ).toBe(false)
  })
})
