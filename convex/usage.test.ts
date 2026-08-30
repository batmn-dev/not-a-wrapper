import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Doc } from "./_generated/dataModel"
import { admitUsageHandler } from "./usage"

type AdmissionCtx = Parameters<typeof admitUsageHandler>[0]

describe("admitUsageHandler", () => {
  const now = Date.UTC(2026, 7, 30, 12)
  const dayStart = Date.UTC(2026, 7, 30)

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
  })

  afterEach(() => vi.useRealTimers())

  it("admits the final guest request and refuses the next one without another write", async () => {
    const usage = {
      _id: "anonymous-usage-1",
      anonymousId: "guest-1",
      dailyMessageCount: 4,
      dailyReset: dayStart,
    }
    const patches: Array<Record<string, unknown>> = []
    const query = {
      unique: async () => usage,
    }
    const index = { eq: () => index }
    const ctx = {
      identity: null,
      user: null,
      db: {
        query: () => ({
          withIndex: (
            _name: string,
            apply: (builder: typeof index) => unknown
          ) => {
            apply(index)
            return query
          },
        }),
        insert: vi.fn(),
        patch: async (_id: string, value: Record<string, unknown>) => {
          patches.push(value)
          Object.assign(usage, value)
        },
      },
    } as unknown as AdmissionCtx

    await expect(
      admitUsageHandler(ctx, { anonymousId: "guest-1" })
    ).resolves.toMatchObject({ canSend: true, count: 5, remaining: 0 })
    await expect(
      admitUsageHandler(ctx, { anonymousId: "guest-1" })
    ).resolves.toMatchObject({ canSend: false, count: 5, remaining: 0 })
    expect(patches).toHaveLength(1)
  })

  it("increments the authenticated total and daily counters together", async () => {
    const user = {
      _id: "user-1",
      anonymous: false,
      messageCount: 9,
      dailyMessageCount: 4,
      dailyReset: dayStart,
    } as Doc<"users">
    const patch = vi.fn()
    const ctx = {
      identity: { subject: "workos-user-1" },
      user,
      db: { patch },
    } as unknown as AdmissionCtx

    await expect(admitUsageHandler(ctx, {})).resolves.toMatchObject({
      canSend: true,
      count: 5,
      remaining: 995,
    })
    expect(patch).toHaveBeenCalledWith("user-1", {
      messageCount: 10,
      dailyMessageCount: 5,
      dailyReset: dayStart,
      lastActiveAt: now,
    })
  })
})
