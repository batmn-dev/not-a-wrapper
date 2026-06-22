import type { Chats } from "@/lib/chat-store/types"
import { describe, expect, it } from "vitest"
import { buildChatHistoryView } from "./utils"

function makeChat(
  overrides: Partial<Chats> & Pick<Chats, "id" | "title">
): Chats {
  const base: Chats = {
    id: "",
    user_id: "user-1",
    title: null,
    model: null,
    system_prompt: null,
    project_id: null,
    public: false,
    pinned: false,
    pinned_at: null,
    created_at: "2026-06-22T00:00:00.000Z",
    updated_at: "2026-06-22T00:00:00.000Z",
  }

  return { ...base, ...overrides } satisfies Chats
}

function flatten(groups: { chats: Chats[] }[]): string[] {
  return groups.flatMap((g) => g.chats.map((c) => c.id))
}

describe("buildChatHistoryView", () => {
  describe("browsing (no query)", () => {
    it("hides project chats and pinned chats from the date groups", () => {
      const chats = [
        makeChat({ id: "regular", title: "Regular" }),
        makeChat({ id: "project", title: "Project", project_id: "p1" }),
        makeChat({ id: "pinned", title: "Pinned", pinned: true }),
      ]

      const view = buildChatHistoryView(chats, "")

      expect(view.isSearching).toBe(false)
      const grouped = flatten(view.groups)
      expect(grouped).toContain("regular")
      expect(grouped).not.toContain("project")
      expect(grouped).not.toContain("pinned")
    })

    it("surfaces pinned non-project chats newest pin first", () => {
      const chats = [
        makeChat({
          id: "older",
          title: "Older pin",
          pinned: true,
          pinned_at: "2026-01-01T00:00:00.000Z",
        }),
        makeChat({
          id: "newer",
          title: "Newer pin",
          pinned: true,
          pinned_at: "2026-06-01T00:00:00.000Z",
        }),
        makeChat({
          id: "project-pin",
          title: "Project pin",
          pinned: true,
          pinned_at: "2026-06-15T00:00:00.000Z",
          project_id: "p1",
        }),
      ]

      const view = buildChatHistoryView(chats, "")

      expect(view.pinned.map((c) => c.id)).toEqual(["newer", "older"])
    })
  })

  describe("searching (query present)", () => {
    it("matches titles across the full set, including project chats", () => {
      const chats = [
        makeChat({ id: "regular", title: "Roadmap planning" }),
        makeChat({ id: "project", title: "Project roadmap", project_id: "p1" }),
        makeChat({ id: "other", title: "Unrelated" }),
      ]

      const view = buildChatHistoryView(chats, "roadmap")

      expect(view.isSearching).toBe(true)
      expect(view.results.map((c) => c.id)).toEqual(["regular", "project"])
      expect(view.pinned).toHaveLength(0)
      expect(view.groups).toHaveLength(0)
    })

    it("treats a whitespace-only query as browsing, not searching", () => {
      const chats = [makeChat({ id: "regular", title: "Regular" })]

      const view = buildChatHistoryView(chats, "   ")

      expect(view.isSearching).toBe(false)
      expect(view.results).toHaveLength(0)
    })
  })
})
