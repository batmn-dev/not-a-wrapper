import type { Doc } from "@/convex/_generated/dataModel"
import type { Chat } from "@/lib/chat-store/types"
import { describe, expect, it } from "vitest"
import {
  deriveSidebarComposition,
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
    pinned: options.pinned ?? false,
  } as unknown as Doc<"projects"> & { pinned: boolean }
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
  const projectPreviews = new Map([
    [
      "alpha",
      {
        chats: [projectRecent, projectOlder, pinnedChat],
        hasMore: false,
      },
    ],
  ])

  it("returns stable empty sections while data is empty", () => {
    const result = deriveSidebarComposition({
      chats: [],
      projects: [],
      projectPreviews: new Map(),
      organization: "by-project",
    })

    expect(result).toMatchObject({
      pinnedChats: [],
      pinnedProjects: [],
      sectionProjects: [],
      historyChats: [],
    })
    expect(result.projectPreviews.size).toBe(0)
    expect(result.projectNames.size).toBe(0)
  })

  it("keeps project chats under projects and out of Chats in By project", () => {
    const result = deriveSidebarComposition({
      chats: [regular, projectOlder, projectRecent, pinnedChat],
      projects,
      projectPreviews,
      organization: "by-project",
    })

    expect(result.historyChats.map(({ id }) => id)).toEqual(["regular"])
    expect(
      result.projectPreviews.get("alpha")?.chats.map(({ id }) => id)
    ).toEqual(["project-recent", "project-older", "pinned-chat"])
    expect(result.pinnedChats).toEqual([])
    expect(result.sectionProjects.map(({ _id }) => _id)).toEqual(["alpha"])
    expect(result.pinnedProjects.map(({ _id }) => _id)).toEqual([
      "pinned-project",
    ])
  })

  it("interleaves project and regular chats in Recents in In one list", () => {
    const result = deriveSidebarComposition({
      chats: [regular, projectOlder, projectRecent, pinnedChat],
      projects,
      projectPreviews,
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
      projectPreviews,
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

  it("does not duplicate a pinned project chat beside its pinned parent", () => {
    const pinnedProjectChat = chat("pinned-project-chat", {
      pinned: true,
      project_id: "pinned-project",
      pinned_at: "2026-01-07T00:00:00.000Z",
      updated_at: "2026-01-07T00:00:00.000Z",
    })
    const result = deriveSidebarComposition({
      chats: [regular, pinnedChat, pinnedProjectChat],
      projects,
      projectPreviews: new Map([
        ["pinned-project", { chats: [pinnedProjectChat], hasMore: false }],
      ]),
      organization: "one-list",
    })

    expect(result.pinnedChats.map(({ id }) => id)).toEqual(["pinned-chat"])
    expect(
      result.projectPreviews.get("pinned-project")?.chats.map(({ id }) => id)
    ).toEqual(["pinned-project-chat"])
  })

  it("does not duplicate recent chats from an expanded pinned project", () => {
    const pinnedProjectRecent = chat("pinned-project-recent", {
      project_id: "pinned-project",
      updated_at: "2026-01-08T00:00:00.000Z",
    })
    const result = deriveSidebarComposition({
      chats: [regular, pinnedProjectRecent],
      projects,
      projectPreviews: new Map([
        ["pinned-project", { chats: [pinnedProjectRecent], hasMore: false }],
      ]),
      organization: "one-list",
    })

    expect(result.historyChats.map(({ id }) => id)).toEqual(["regular"])
    expect(
      result.projectPreviews.get("pinned-project")?.chats.map(({ id }) => id)
    ).toEqual(["pinned-project-recent"])
  })
})
