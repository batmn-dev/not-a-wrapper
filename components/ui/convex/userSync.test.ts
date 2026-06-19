import { afterEach, describe, expect, it, vi } from "vitest"
import type { MutationCtx } from "./_generated/server"
import {
  softDeleteAppUserFromWorkOS,
  upsertAppUserFromWorkOS,
} from "./userSync"

type StoredUser = {
  _id: string
  workosUserId: string
  email: string
  displayName?: string
  profileImage?: string
  anonymous?: boolean
  premium?: boolean
  messageCount?: number
  dailyMessageCount?: number
  dailyProMessageCount?: number
  lastActiveAt?: number
  lastSyncedFromWorkOSAt?: number
  workosUpdatedAt?: string
  deletedAt?: number
  disabledAt?: number
}

function createMutationCtx(initialUser?: StoredUser) {
  let user = initialUser
  let nextId = 1

  const ctx = {
    db: {
      query: (tableName: string) => {
        expect(tableName).toBe("users")

        return {
          withIndex: (
            indexName: string,
            buildQuery: (q: {
              eq: (fieldName: string, value: string) => unknown
            }) => unknown
          ) => {
            expect(indexName).toBe("by_workos_user_id")

            let requestedWorkosUserId: string | null = null
            buildQuery({
              eq: (fieldName, value) => {
                expect(fieldName).toBe("workosUserId")
                requestedWorkosUserId = value
                return {}
              },
            })

            return {
              unique: async () =>
                user?.workosUserId === requestedWorkosUserId ? user : null,
            }
          },
        }
      },
      insert: async (tableName: string, value: Omit<StoredUser, "_id">) => {
        expect(tableName).toBe("users")

        const id = `user_${nextId++}`
        user = { _id: id, ...value }
        return id
      },
      patch: async (id: string, value: Partial<StoredUser>) => {
        expect(user?._id).toBe(id)
        user = { ...user, ...value } as StoredUser
      },
    },
  } as unknown as MutationCtx

  return {
    ctx,
    getUser: () => user,
  }
}

describe("softDeleteAppUserFromWorkOS", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("persists a deleted tombstone when no app user exists yet", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000)
    const { ctx, getUser } = createMutationCtx()

    const userId = await softDeleteAppUserFromWorkOS(ctx, {
      workosUserId: "user_01",
      email: "deleted@example.com",
      firstName: "Deleted",
      lastName: "User",
      profileImage: "https://example.com/avatar.png",
      workosUpdatedAt: "2026-01-02T00:00:00.000Z",
    })

    expect(userId).toBe("user_1")
    expect(getUser()).toMatchObject({
      _id: "user_1",
      workosUserId: "user_01",
      email: "deleted@example.com",
      displayName: "Deleted User",
      profileImage: "https://example.com/avatar.png",
      anonymous: false,
      premium: false,
      messageCount: 0,
      dailyMessageCount: 0,
      dailyProMessageCount: 0,
      deletedAt: 1700000000000,
      disabledAt: 1700000000000,
      lastSyncedFromWorkOSAt: 1700000000000,
      workosUpdatedAt: "2026-01-02T00:00:00.000Z",
    })
  })

  it("keeps a deleted tombstone when an older create or update is replayed later", async () => {
    const { ctx, getUser } = createMutationCtx()

    await softDeleteAppUserFromWorkOS(ctx, {
      workosUserId: "user_01",
      email: "deleted@example.com",
      workosUpdatedAt: "2026-01-02T00:00:00.000Z",
    })

    const userId = await upsertAppUserFromWorkOS(ctx, {
      workosUserId: "user_01",
      email: "active@example.com",
      firstName: "Active",
      workosUpdatedAt: "2026-01-01T00:00:00.000Z",
    })

    expect(userId).toBe("user_1")
    expect(getUser()).toMatchObject({
      email: "deleted@example.com",
      deletedAt: expect.any(Number),
      disabledAt: expect.any(Number),
      workosUpdatedAt: "2026-01-02T00:00:00.000Z",
    })
  })
})
