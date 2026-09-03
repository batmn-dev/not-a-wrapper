import type { Doc } from "@/convex/_generated/dataModel"
import type { Chat } from "@/lib/chat-store/types"
import { describe, expect, it } from "vitest"
import {
  deriveSidebarComposition,
  deriveSidebarSelection,
  type SidebarProjectModel,
} from "./sidebar-composition"

function chat(
  id: string,
  options: Partial<Chat> & Pick<Chat, "updated_at"> = { updated_at: null }
): Chat {
  return {
    id,
    user_id: "user",
    title: id,
    model: null,
    project_id: null,
    public: false,
    pinned: false,
    pinned_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...options,
  }
}

function project(
  id: string,
  options: { pinned?: boolean; created?: number } = {}
): SidebarProjectModel {
  return {
    _id: id,
    _creationTime: options.created ?? 1,
    userId: "user",
    name: id,
    updatedAt: options.created ?? 1,
    pinned: options.pinned ?? false,
  } as unknown as Doc<"projects">
}

describe("sidebar grouping composition", () => {
  const regular = chat("regular", {
    updated_at: "2026-01-03T00:00:00.000Z",
  })
  const projectRecent = chat("project-recent", {
    project_id: "alpha",
    updated_at: "2026-01-04T00:00:00.000Z",
  })
  const projectOlder = chat("project-older", {
    project_id: "alpha",
    updated_at: "2026-01-02T00:00:00.000Z",
  })
  const pinnedChat = chat("pinned-chat", {
    pinned: true,
    project_id: "alpha",
    pinned_at: "2026-01-05T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  })
  const projects = [
    project("alpha", { created: 1 }),
    project("pinned-project", { pinned: true, created: 2 }),
  ]
  it("keeps project recents on project home while retaining pinned project chats", () => {
    const result = deriveSidebarComposition({
      chats: [regular, projectOlder, projectRecent, pinnedChat],
      projects,
      organization: "by-project",
    })

    expect(result.historyChats.map(({ id }) => id)).toEqual(["regular"])
    expect(result.pinnedChats.map(({ id }) => id)).toEqual(["pinned-chat"])
    expect(result.sectionProjects.map(({ _id }) => _id)).toEqual(["alpha"])
    expect(result.pinnedProjects.map(({ _id }) => _id)).toEqual([
      "pinned-project",
    ])
  })

  it("interleaves project and regular chats in Recents in In one list", () => {
    const result = deriveSidebarComposition({
      chats: [regular, projectOlder, projectRecent, pinnedChat],
      projects,
      organization: "one-list",
    })

    expect(result.historyChats.map(({ id }) => id)).toEqual([
      "project-recent",
      "regular",
      "project-older",
    ])
    expect(new Set(result.historyChats.map(({ id }) => id)).size).toBe(
      result.historyChats.length
    )
    expect(result.projectNames.get("alpha")).toBe("alpha")
    expect(result.pinnedChats.map(({ id }) => id)).toEqual(["pinned-chat"])
  })

  it("orders pinned chats by pinned time and projects newest-first", () => {
    const firstPinnedChat = chat("first-pinned", {
      pinned: true,
      pinned_at: "2026-01-05T00:00:00.000Z",
      updated_at: "2026-01-05T00:00:00.000Z",
    })
    const secondPinnedChat = chat("second-pinned", {
      pinned: true,
      pinned_at: "2026-01-06T00:00:00.000Z",
      updated_at: "2026-01-06T00:00:00.000Z",
    })
    const secondProject = project("second", { created: 3 })
    const result = deriveSidebarComposition({
      chats: [firstPinnedChat, secondPinnedChat],
      projects: [...projects, secondProject],
      organization: "by-project",
    })

    expect(result.pinnedChats.map(({ id }) => id)).toEqual([
      "second-pinned",
      "first-pinned",
    ])
    expect(result.sectionProjects.map(({ _id }) => _id)).toEqual([
      "second",
      "alpha",
    ])
  })

  it("keeps chats from a pinned project in their chat sections", () => {
    const pinnedProjectChat = chat("pinned-project-chat", {
      pinned: true,
      project_id: "pinned-project",
      pinned_at: "2026-01-07T00:00:00.000Z",
      updated_at: "2026-01-07T00:00:00.000Z",
    })
    const pinnedProjectRecent = chat("pinned-project-recent", {
      project_id: "pinned-project",
      updated_at: "2026-01-08T00:00:00.000Z",
    })
    const result = deriveSidebarComposition({
      chats: [regular, pinnedChat, pinnedProjectChat, pinnedProjectRecent],
      projects,
      organization: "one-list",
    })

    expect(result.pinnedChats.map(({ id }) => id)).toEqual([
      "pinned-project-chat",
      "pinned-chat",
    ])
    expect(result.historyChats.map(({ id }) => id)).toEqual([
      "pinned-project-recent",
      "regular",
    ])
  })
})

describe("sidebar selection", () => {
  it("keeps the new-chat action selected until the session commits a chat id", () => {
    expect(
      deriveSidebarSelection({
        isNewChatSurface: true,
        sessionChatId: null,
      })
    ).toEqual({
      currentChatId: undefined,
      isNewChatActive: true,
    })
  })

  it("selects the session's chat id, which a first turn commits before its row exists", () => {
    expect(
      deriveSidebarSelection({
        isNewChatSurface: false,
        sessionChatId: "chat-minted",
      })
    ).toEqual({
      currentChatId: "chat-minted",
      isNewChatActive: false,
    })
  })

  it("selects nothing on a chat-less route outside the new-chat surface", () => {
    expect(
      deriveSidebarSelection({
        isNewChatSurface: false,
        sessionChatId: null,
      })
    ).toEqual({
      currentChatId: undefined,
      isNewChatActive: false,
    })
  })
})
