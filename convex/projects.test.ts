import { describe, expect, it } from "vitest"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx } from "./_generated/server"
import { backfillUpdatedAtBatch } from "./projects"

function asId<Table extends "users" | "projects" | "chats">(
  value: string
): Id<Table> {
  return value as Id<Table>
}

function project(
  id: string,
  overrides: Partial<Doc<"projects">> = {}
): Doc<"projects"> {
  return {
    _id: asId<"projects">(id),
    _creationTime: 10,
    userId: asId<"users">("user-1"),
    name: id,
    ...overrides,
  }
}

function chat(
  id: string,
  projectId: Id<"projects">,
  updatedAt: number
): Doc<"chats"> {
  return {
    _id: asId<"chats">(id),
    _creationTime: 10,
    userId: asId<"users">("user-1"),
    projectId,
    title: id,
    public: false,
    pinned: false,
    updatedAt,
  }
}

function createCtx({
  projects,
  chats,
  isDone,
  continueCursor,
}: {
  projects: Doc<"projects">[]
  chats: Doc<"chats">[]
  isDone: boolean
  continueCursor: string
}) {
  const paginationOptions: unknown[] = []
  const patches: Array<{ id: string; updatedAt: number }> = []
  const scheduled: Array<{ delay: number; args: unknown }> = []

  const ctx = {
    db: {
      query: (tableName: "projects" | "chats") => {
        if (tableName === "projects") {
          return {
            paginate: async (options: unknown) => {
              paginationOptions.push(options)
              return { page: projects, isDone, continueCursor }
            },
          }
        }

        return {
          withIndex: (
            _indexName: string,
            buildQuery: (query: {
              eq: (fieldName: string, value: unknown) => unknown
            }) => unknown
          ) => {
            let projectId: unknown
            const query = {
              eq: (fieldName: string, value: unknown) => {
                expect(fieldName).toBe("projectId")
                projectId = value
                return query
              },
            }
            buildQuery(query)
            const newestChat = chats
              .filter((candidate) => candidate.projectId === projectId)
              .sort((a, b) => b.updatedAt - a.updatedAt)[0]

            const orderedQuery = {
              order: (direction: "asc" | "desc") => {
                expect(direction).toBe("desc")
                return orderedQuery
              },
              first: async () => newestChat ?? null,
            }
            return orderedQuery
          },
        }
      },
      patch: async (id: Id<"projects">, value: { updatedAt: number }) => {
        patches.push({ id: id as string, updatedAt: value.updatedAt })
      },
    },
    scheduler: {
      runAfter: async (
        _delay: number,
        _functionReference: unknown,
        args: unknown
      ) => {
        scheduled.push({ delay: _delay, args })
        return "scheduled-id"
      },
    },
  } as unknown as MutationCtx

  return { ctx, paginationOptions, patches, scheduled }
}

describe("backfillUpdatedAtBatch", () => {
  it("schedules the next bounded page with cumulative counts", async () => {
    const firstProject = project("project-1", { updatedAt: 20 })
    const secondProject = project("project-2", { updatedAt: 40 })
    const { ctx, paginationOptions, patches, scheduled } = createCtx({
      projects: [firstProject, secondProject],
      chats: [
        chat("chat-1", firstProject._id, 30),
        chat("chat-2", secondProject._id, 35),
      ],
      isDone: false,
      continueCursor: "next-page",
    })

    await expect(
      backfillUpdatedAtBatch(ctx, { total: 5, patched: 2 })
    ).resolves.toEqual({ isDone: false, total: 7, patched: 3 })

    expect(paginationOptions).toEqual([{ cursor: null, numItems: 50 }])
    expect(patches).toEqual([{ id: "project-1", updatedAt: 30 }])
    expect(scheduled).toEqual([
      {
        delay: 0,
        args: { cursor: "next-page", total: 7, patched: 3 },
      },
    ])
  })

  it("finishes without scheduling another page", async () => {
    const legacyProject = project("project-3")
    const { ctx, paginationOptions, patches, scheduled } = createCtx({
      projects: [legacyProject],
      chats: [],
      isDone: true,
      continueCursor: "",
    })

    await expect(
      backfillUpdatedAtBatch(ctx, {
        cursor: "next-page",
        total: 7,
        patched: 3,
      })
    ).resolves.toEqual({ isDone: true, total: 8, patched: 4 })

    expect(paginationOptions).toEqual([{ cursor: "next-page", numItems: 50 }])
    expect(patches).toEqual([{ id: "project-3", updatedAt: 10 }])
    expect(scheduled).toEqual([])
  })
})
