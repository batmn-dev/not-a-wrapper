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

// The one subtle behavior bounding the sidebar introduces: the id-keyed
// optimistic overlay must apply in-window ops but be a NO-OP for ops targeting a
// chat outside the window (that chat is shown — and updated — by another surface).
describe("applyOptimisticOps over the bounded window", () => {
  it("prepends an optimistic add and applies an in-window update", () => {
    const window = [makeChat({ id: "in-window", title: "Old" })]
    const ops: OptimisticOperation[] = [
      {
        type: "add",
        chat: makeChat({ id: "new", updated_at: "2026-06-10T00:00:00.000Z" }),
      },
      { type: "update", id: "in-window", changes: { title: "New" } },
    ]

    const result = applyOptimisticOps(window, ops)

    expect(result.map((c) => c.id)).toEqual(["new", "in-window"])
    expect(result.find((c) => c.id === "in-window")?.title).toBe("New")
  })

  it("ignores update/delete ops that target out-of-window chats", () => {
    const window = [makeChat({ id: "in-window" })]
    const ops: OptimisticOperation[] = [
      { type: "update", id: "out-of-window", changes: { title: "X" } },
      { type: "delete", id: "also-out-of-window" },
    ]

    expect(applyOptimisticOps(window, ops).map((c) => c.id)).toEqual([
      "in-window",
    ])
  })
})

describe("partitionSidebarChats", () => {
  it("retains project membership for sidebar composition", () => {
    const projectChat = makeChat({ id: "project", project_id: "project-1" })
    const pinnedProjectChat = makeChat({
      id: "pinned-project",
      project_id: "project-1",
      pinned: true,
      pinned_at: "2026-06-02T00:00:00.000Z",
    })

    const result = partitionSidebarChats([projectChat, pinnedProjectChat])

    expect(result.nonPinned.map(({ id }) => id)).toEqual(["project"])
    expect(result.pinned.map(({ id }) => id)).toEqual(["pinned-project"])
  })
})

describe("deriveSidebarLoading", () => {
  it("keeps the paginated sidebar loading until every first-page read is ready", () => {
    expect(
      deriveSidebarLoading({
        isConvexAuthLoading: false,
        isConvexAuthenticated: true,
        paginated: true,
        fullListPending: false,
        firstPagePending: true,
        shouldUseLocalChats: false,
        cachedChatsHydrated: true,
      })
    ).toBe(true)

    expect(
      deriveSidebarLoading({
        isConvexAuthLoading: false,
        isConvexAuthenticated: true,
        paginated: true,
        fullListPending: false,
        firstPagePending: false,
        shouldUseLocalChats: false,
        cachedChatsHydrated: true,
      })
    ).toBe(false)
  })
})
