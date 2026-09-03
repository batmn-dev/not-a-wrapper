import { describe, expect, it } from "vitest"
import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"
import { CHAT_PROJECT_LINK_OWNER_ERROR } from "./chat_project_link"
import {
  patchChatActivity,
  patchProjectActivity,
  recordKnownProjectActivity,
} from "./project_activity"

function asId<Table extends "users" | "projects" | "chats">(
  value: string
): Id<Table> {
  return value as Id<Table>
}

function project(overrides: Partial<Doc<"projects">> = {}): Doc<"projects"> {
  return {
    _id: asId<"projects">("project-1"),
    _creationTime: 10,
    userId: asId<"users">("user-1"),
    name: "Project",
    updatedAt: 10,
    pinned: false,
    ...overrides,
  }
}

function chat(overrides: Partial<Doc<"chats">> = {}): Doc<"chats"> {
  return {
    _id: asId<"chats">("chat-1"),
    _creationTime: 10,
    publicId: "chat-1-public",
    userId: asId<"users">("user-1"),
    projectId: asId<"projects">("project-1"),
    title: "Chat",
    public: false,
    pinned: false,
    updatedAt: 15,
    ...overrides,
  }
}

function createMutationCtx(documents: Array<Doc<"projects"> | Doc<"chats">>) {
  const stored = new Map(
    documents.map((document) => [document._id as string, document])
  )
  const patches: Array<{ id: string; value: Record<string, unknown> }> = []
  let reads = 0

  const ctx = {
    db: {
      get: async (id: Id<"projects"> | Id<"chats">) => {
        reads++
        return stored.get(id as string) ?? null
      },
      patch: async (
        id: Id<"projects"> | Id<"chats">,
        value: Record<string, unknown>
      ) => {
        patches.push({ id: id as string, value })
        const current = stored.get(id as string)
        if (!current) throw new Error("Document not found")
        Object.assign(current, value)
      },
    },
  } as unknown as Pick<MutationCtx, "db">

  return { ctx, patches, reads: () => reads }
}

describe("project activity", () => {
  it("patches metadata without allowing the activity clock to regress", async () => {
    const storedProject = project({ updatedAt: 30 })
    const { ctx, patches } = createMutationCtx([storedProject])

    await patchProjectActivity(ctx, storedProject, { name: "Renamed" }, 20)

    expect(patches).toEqual([
      {
        id: "project-1",
        value: { name: "Renamed", updatedAt: 30 },
      },
    ])
  })

  it("propagates one timestamp from chat activity to its project", async () => {
    const storedProject = project()
    const storedChat = chat()
    const { ctx, patches } = createMutationCtx([storedProject, storedChat])

    await patchChatActivity(ctx, storedChat, { title: "Renamed chat" }, 20)

    expect(patches).toEqual([
      {
        id: "chat-1",
        value: { title: "Renamed chat", updatedAt: 20 },
      },
      { id: "project-1", value: { updatedAt: 20 } },
    ])
  })

  it("skips parent reads for ordinary chats and stale project events", async () => {
    const ordinaryChat = chat({ projectId: undefined })
    const storedProject = project({ updatedAt: 30 })
    const { ctx, patches, reads } = createMutationCtx([
      ordinaryChat,
      storedProject,
    ])

    await patchChatActivity(ctx, ordinaryChat, {}, 20)
    await recordKnownProjectActivity(ctx, storedProject, 20)

    expect(reads()).toBe(0)
    expect(patches).toEqual([
      { id: "chat-1", value: { updatedAt: 20 } },
    ])
  })

  it("rejects a broken project reference instead of hiding corruption", async () => {
    const orphanedChat = chat({ projectId: asId<"projects">("missing") })
    const { ctx, patches } = createMutationCtx([orphanedChat])

    await expect(
      patchChatActivity(ctx, orphanedChat, {}, 20)
    ).rejects.toThrow("Project not found")
    expect(patches).toEqual([])
  })

  it("rejects a cross-owner project link before writing anything", async () => {
    const foreignProject = project({ userId: asId<"users">("user-2") })
    const linkedChat = chat()
    const { ctx, patches } = createMutationCtx([foreignProject, linkedChat])

    await expect(
      patchChatActivity(ctx, linkedChat, { title: "Renamed" }, 20)
    ).rejects.toThrow(CHAT_PROJECT_LINK_OWNER_ERROR)
    expect(patches).toEqual([])
  })
})
