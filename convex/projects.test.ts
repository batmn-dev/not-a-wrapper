import { describe, expect, it } from "vitest"
import {
  MAX_PROJECT_NAME_LENGTH,
  normalizeProjectName,
  PROJECT_NAME_REQUIRED_MESSAGE,
} from "../lib/projects/policy"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx } from "./_generated/server"
import { removeProjectForOwner } from "./projects"

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
    updatedAt: 10,
    pinned: false,
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
    publicId: `${id}-public`,
    userId: asId<"users">("user-1"),
    projectId,
    title: id,
    public: false,
    pinned: false,
    updatedAt,
  }
}

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
        get: async (id: string) => jobs.find((job) => job._id === id) ?? null,
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
    expect(scheduled).toEqual([{ delay: 0, args: { jobId: "job-1" } }])
    expect(linkedChat).toMatchObject({
      _id: "chat-1",
      projectId: projectDoc._id,
    })
    expect(deleted).toEqual([])
  })
})

describe("normalizeProjectName", () => {
  it("rejects blank and over-long trimmed names, as create and updateName do", () => {
    const maxName = "a".repeat(MAX_PROJECT_NAME_LENGTH)
    expect(normalizeProjectName(`  ${maxName}  `)).toBe(maxName)
    expect(() => normalizeProjectName(`${maxName}b`)).toThrow(
      `${MAX_PROJECT_NAME_LENGTH} characters`
    )
    expect(() => normalizeProjectName("   ")).toThrow(
      PROJECT_NAME_REQUIRED_MESSAGE
    )
  })
})
