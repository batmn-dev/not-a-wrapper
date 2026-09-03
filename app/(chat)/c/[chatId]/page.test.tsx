import { describe, expect, it } from "vitest"
import Page from "./page"

describe("/c/[chatId] page", () => {
  it("renders null for every chat id, leaving the Chat surface to the layout", () => {
    // Chat identity is client-minted and shape-identical for guests and
    // signed-in users (ADR-0033), so the segment has no server duty: the
    // persistent (chat)/layout.tsx mounts Chat, which resolves the id against
    // the caller's own store and renders not-found when nothing answers.
    expect(Page()).toBeNull()
  })
})
