import { describe, expect, it } from "vitest"
import type { Doc, Id } from "./_generated/dataModel"
import type { QueryCtx } from "./_generated/server"
import { filterToolCallLogPageForActiveChats } from "./toolCallLog"

function asId<
  Table extends "users" | "projects" | "chats" | "toolCallLog",
>(value: string): Id<Table> {
  return value as Id<Table>
}

function chat(
  id: string,
  userId: Id<"users">,
  overrides: Partial<Doc<"chats">> = {}
): Doc<"chats"> {
  return {
    _id: asId<"chats">(id),
    _creationTime: 1,
    userId,
    public: false,
    pinned: false,
    updatedAt: 1,
    ...overrides,
  }
}

function log(
  id: string,
  userId: Id<"users">,
  chatId?: Id<"chats">
): Doc<"toolCallLog"> {
  return {
    _id: asId<"toolCallLog">(id),
    _creationTime: 1,
    userId,
    chatId,
    toolName: "search",
    toolCallId: id,
    success: true,
    createdAt: 1,
    source: "builtin",
  }
}

describe("tool-call history deletion projection", () => {
  it("keeps chatless and active rows while hiding missing or tombstoned roots", async () => {
    const user: Doc<"users"> = {
      _id: asId<"users">("user-1"),
      _creationTime: 1,
      workosUserId: "workos-user-1",
      email: "user@example.com",
    }
    const otherUserId = asId<"users">("user-2")
    const activeProject: Doc<"projects"> = {
      _id: asId<"projects">("project-active"),
      _creationTime: 1,
      userId: user._id,
      name: "Active",
      updatedAt: 1,
      pinned: false,
    }
    const deletingProject: Doc<"projects"> = {
      _id: asId<"projects">("project-deleting"),
      _creationTime: 1,
      userId: user._id,
      name: "Deleting",
      updatedAt: 1,
      pinned: false,
      deletingAt: 2,
    }
    const activeChat = chat("chat-active", user._id, {
      projectId: activeProject._id,
    })
    const activeSibling = chat("chat-active-sibling", user._id, {
      projectId: activeProject._id,
    })
    const projectDeletingChat = chat("chat-project-deleting", user._id, {
      projectId: deletingProject._id,
    })
    const rootDeletingChat = chat("chat-root-deleting", user._id, {
      deletingAt: 2,
    })
    const foreignChat = chat("chat-foreign", otherUserId)
    const documents = [
      activeChat,
      activeSibling,
      projectDeletingChat,
      rootDeletingChat,
      foreignChat,
      activeProject,
      deletingProject,
    ]
    const reads: string[] = []
    const ctx = {
      db: {
        get: async (id: string) => {
          reads.push(id)
          return documents.find((document) => document._id === id) ?? null
        },
      },
    } as unknown as Pick<QueryCtx, "db">
    const chatless = log("log-chatless", user._id)
    const active = log("log-active", user._id, activeChat._id)
    const activeSiblingLog = log(
      "log-active-sibling",
      user._id,
      activeSibling._id
    )
    const parentDeleting = log(
      "log-parent-deleting",
      user._id,
      projectDeletingChat._id
    )
    const rootDeleting = log(
      "log-root-deleting",
      user._id,
      rootDeletingChat._id
    )
    const missing = log(
      "log-missing",
      user._id,
      asId<"chats">("chat-missing")
    )
    const foreign = log("log-foreign", user._id, foreignChat._id)

    await expect(
      filterToolCallLogPageForActiveChats(ctx, user, [
        chatless,
        active,
        activeSiblingLog,
        parentDeleting,
        rootDeleting,
        missing,
        foreign,
      ])
    ).resolves.toEqual([chatless, active, activeSiblingLog])
    expect(reads.filter((id) => id === activeProject._id)).toHaveLength(1)
  })
})
