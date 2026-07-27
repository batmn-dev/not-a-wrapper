import { describe, expect, it } from "vitest"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx } from "./_generated/server"
import { backfillUpdatedAtBatch, removeProjectForOwner } from "./projects"

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
            let matchingChats = chats.filter(
              (candidate) => candidate.projectId === projectId
            )

            const orderedQuery = {
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
                matchingChats = matchingChats.filter(
                  (candidate) =>
                    (candidate as unknown as Record<string, unknown>)[
                      fieldName
                    ] === expected
                )
                return orderedQuery
              },
              order: (direction: "asc" | "desc") => {
                expect(direction).toBe("desc")
                return orderedQuery
              },
              first: async () =>
                [...matchingChats].sort(
                  (a, b) => b.updatedAt - a.updatedAt
                )[0] ?? null,
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

  it("does not patch a tombstoned project", async () => {
    const deletingProject = project("project-deleting", {
      deletingAt: 30,
    })
    const { ctx, patches, scheduled } = createCtx({
      projects: [deletingProject],
      chats: [chat("chat-1", deletingProject._id, 40)],
      isDone: true,
      continueCursor: "",
    })

    await expect(backfillUpdatedAtBatch(ctx, {})).resolves.toEqual({
      isDone: true,
      total: 1,
      patched: 0,
    })
    expect(patches).toEqual([])
    expect(scheduled).toEqual([])
  })
})

describe("removeProjectForOwner", () => {
  it("tombstones and schedules without synchronously deleting linked chats", async () => {
    const owner: Doc<"users"> = {
      _id: asId<"users">("user-1"),
      _creationTime: 1,
      workosUserId: "workos-user-1",
      email: "user@example.com",
    }
    const projectDoc = project("project-1")
    const linkedChat = chat("chat-1", projectDoc._id, 30)
    const jobs: Array<Record<string, unknown>> = []
    const scheduled: Array<{ delay: number; args: unknown }> = []
    const deleted: string[] = []
    const ctx = {
      project: projectDoc,
      user: owner,
      db: {
        get: async (id: string) =>
          jobs.find((job) => job._id === id) ?? null,
        patch: async (id: string, patch: Record<string, unknown>) => {
          expect(id).toBe(projectDoc._id)
          Object.assign(projectDoc, patch)
        },
        insert: async (tableName: string, value: Record<string, unknown>) => {
          expect(tableName).toBe("deletionJobs")
          const id = "job-1"
          jobs.push({ _id: id, _creationTime: 1, ...value })
          return id
        },
        delete: async (id: string) => deleted.push(id),
        query: (tableName: string) => {
          expect(tableName).toBe("deletionJobs")
          const resultApi = {
            withIndex: (
              indexName: string,
              build: (query: {
                eq: (field: string, value: unknown) => unknown
              }) => unknown
            ) => {
              expect(indexName).toBe("by_project")
              const query = {
                eq: (field: string, value: unknown) => {
                  expect(field).toBe("projectId")
                  expect(value).toBe(projectDoc._id)
                  return query
                },
              }
              build(query)
              return resultApi
            },
            filter: () => resultApi,
            first: async () => null,
          }
          return resultApi
        },
      },
      scheduler: {
        runAfter: async (delay: number, _fn: unknown, args: unknown) => {
          scheduled.push({ delay, args })
          return "scheduled-id"
        },
      },
      storage: {},
      meta: {},
    } as unknown as MutationCtx & {
      project: Doc<"projects">
      user: Doc<"users">
    }

    await removeProjectForOwner(ctx)

    expect(projectDoc).toMatchObject({
      deletingAt: expect.any(Number),
      updatedAt: expect.any(Number),
    })
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({
      targetKind: "project",
      projectId: projectDoc._id,
      state: "pending",
      phase: "chats",
    })
    expect(scheduled).toEqual([
      { delay: 0, args: { jobId: "job-1" } },
    ])
    expect(linkedChat).toMatchObject({ _id: "chat-1", projectId: projectDoc._id })
    expect(deleted).toEqual([])
  })
})
