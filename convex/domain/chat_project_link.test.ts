import { describe, expect, it } from "vitest"
import type { Doc, Id } from "../_generated/dataModel"
import type { QueryCtx } from "../_generated/server"
import {
  CHAT_PROJECT_LINK_OWNER_ERROR,
  collectLinkedChats,
  requireLinkedProject,
  takeLinkedChats,
} from "./chat_project_link"

function asId<Table extends "users" | "projects" | "chats">(
  value: string
): Id<Table> {
  return value as Id<Table>
}

function project(overrides: Partial<Doc<"projects">> = {}): Doc<"projects"> {
  return {
    _id: asId<"projects">("project-1"),
    _creationTime: 1,
    userId: asId<"users">("user-1"),
    name: "Project",
    updatedAt: 1,
    pinned: false,
    ...overrides,
  }
}

function chat(id: string, overrides: Partial<Doc<"chats">> = {}): Doc<"chats"> {
  return {
    _id: asId<"chats">(id),
    _creationTime: 1,
    publicId: `${id}-public`,
    userId: asId<"users">("user-1"),
    projectId: asId<"projects">("project-1"),
    title: id,
    public: false,
    pinned: false,
    updatedAt: 20,
    ...overrides,
  }
}

function createCtx(documents: {
  projects?: Doc<"projects">[]
  chats?: Doc<"chats">[]
}) {
  const projects = documents.projects ?? []
  const chats = documents.chats ?? []

  return {
    db: {
      get: async (id: Id<"projects">) =>
        projects.find((document) => document._id === id) ?? null,
      query: () => ({
        withIndex: (
          _indexName: string,
          buildQuery: (query: {
            eq: (fieldName: string, value: unknown) => unknown
          }) => unknown
        ) => {
          let projectId: unknown
          const query = {
            eq: (_fieldName: string, value: unknown) => {
              projectId = value
              return query
            },
          }
          buildQuery(query)
          let results = chats.filter(
            (document) => document.projectId === projectId
          )

          const resultApi = {
            filter: (
              buildFilter: (query: {
                eq: (fieldName: unknown, value: unknown) => boolean
                field: (fieldName: string) => string
              }) => unknown
            ) => {
              let fieldName = ""
              let expected: unknown
              buildFilter({
                field: (field) => {
                  fieldName = field
                  return field
                },
                eq: (_field, value) => {
                  expected = value
                  return true
                },
              })
              results = results.filter(
                (document) =>
                  (document as unknown as Record<string, unknown>)[
                    fieldName
                  ] === expected
              )
              return resultApi
            },
            collect: async () => results,
            take: async (limit: number) => results.slice(0, limit),
          }
          return resultApi
        },
      }),
    },
  } as unknown as Pick<QueryCtx, "db">
}

describe("Chat-Project link", () => {
  it("resolves a healthy link and passes through non-project chats", async () => {
    const storedProject = project()
    const ctx = createCtx({ projects: [storedProject] })

    expect(await requireLinkedProject(ctx, chat("chat-1"))).toBe(storedProject)
    expect(
      await requireLinkedProject(ctx, chat("chat-2", { projectId: undefined }))
    ).toBeNull()
  })

  it("rejects dangling and cross-owner parent links", async () => {
    const foreignProject = project({ userId: asId<"users">("user-2") })
    const ctx = createCtx({ projects: [foreignProject] })

    await expect(
      requireLinkedProject(
        ctx,
        chat("chat-1", { projectId: asId<"projects">("missing") })
      )
    ).rejects.toThrow("Project not found")
    await expect(requireLinkedProject(ctx, chat("chat-1"))).rejects.toThrow(
      CHAT_PROJECT_LINK_OWNER_ERROR
    )
  })

  it("rejects a collected range containing another user's chat", async () => {
    const storedProject = project()
    const ctx = createCtx({
      projects: [storedProject],
      chats: [
        chat("chat-1"),
        chat("chat-2", { userId: asId<"users">("user-2") }),
      ],
    })

    await expect(collectLinkedChats(ctx, storedProject)).rejects.toThrow(
      CHAT_PROJECT_LINK_OWNER_ERROR
    )
  })

  it("takes a bounded owner-checked Project Chat range", async () => {
    const storedProject = project()
    const first = chat("chat-1")
    const second = chat("chat-2")
    const ctx = createCtx({
      projects: [storedProject],
      chats: [first, second],
    })

    await expect(takeLinkedChats(ctx, storedProject, 1)).resolves.toEqual([
      first,
    ])
  })
})
