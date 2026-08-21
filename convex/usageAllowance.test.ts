import { afterEach, describe, expect, it, vi } from "vitest"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx } from "./_generated/server"
import type { PricingSnapshot } from "./domain/usage_accounting"
import { signUsageReservationAuthorization } from "./lib/usageReservationAuthorization"
import {
  attachReservationToRun,
  ensureCurrentUsageBucket,
  reconcileStaleUsageReservationsPass,
  releaseUnattachedForUser,
  reserveAuthorizedHandler,
  reserveUsageForUser,
  settleUsageForTerminalRun,
  STALE_RESERVATION_MS,
  type AuthorizedReserveUsageArgs,
  type ReserveUsageArgs,
} from "./usageAllowance"

// Compact fake MutationCtx for the allowance tables. Convex serializes
// mutations, so concurrency here means "the second transaction sees the
// first's committed state" — which is exactly what sequential calls against
// one shared store exercise.

type Tables = {
  users: Doc<"users">[]
  generationRuns: Doc<"generationRuns">[]
  usageBuckets: Doc<"usageBuckets">[]
  usageReservations: Doc<"usageReservations">[]
  usageLedgerEntries: Doc<"usageLedgerEntries">[]
  apiRateLimits: Doc<"apiRateLimits">[]
}

function createCtx(input: Partial<Tables> = {}) {
  const tables: Tables = {
    users: [],
    generationRuns: [],
    usageBuckets: [],
    usageReservations: [],
    usageLedgerEntries: [],
    apiRateLimits: [],
    ...input,
  }
  const all = () => Object.values(tables).flat() as Array<{ _id: string }>
  let counter = 0

  const ctx = {
    db: {
      get: async (id: string) => all().find((doc) => doc._id === id) ?? null,
      insert: async (tableName: keyof Tables, value: object) => {
        const id = `${tableName}_${++counter}`
        ;(tables[tableName] as object[]).push({
          _id: id,
          _creationTime: Date.now(),
          ...value,
        })
        return id
      },
      patch: async (id: string, value: object) => {
        const doc = all().find((candidate) => candidate._id === id)
        if (!doc) throw new Error(`patch: missing ${id}`)
        Object.assign(doc, value)
      },
      query: (tableName: keyof Tables) => ({
        withIndex: (_index: string, build: (q: unknown) => unknown) => {
          const filters = new Map<string, unknown>()
          const ranges: Array<{ field: string; op: "lt"; value: number }> = []
          const q = {
            eq: (field: string, value: unknown) => {
              filters.set(field, value)
              return q
            },
            lt: (field: string, value: number) => {
              ranges.push({ field, op: "lt", value })
              return q
            },
          }
          build(q)
          const results = (
            tables[tableName] as Array<Record<string, unknown>>
          ).filter((doc) => {
            for (const [field, value] of filters) {
              if (doc[field] !== value) return false
            }
            for (const range of ranges) {
              const current = doc[range.field]
              if (typeof current !== "number" || current >= range.value) {
                return false
              }
            }
            return true
          })
          return {
            unique: async () => {
              expect(results.length).toBeLessThanOrEqual(1)
              return results[0] ?? null
            },
            first: async () => results[0] ?? null,
            take: async (limit: number) => results.slice(0, limit),
            collect: async () => results,
          }
        },
      }),
    },
  } as unknown as MutationCtx

  return { ctx, tables }
}

const user = {
  _id: "users_1" as Id<"users">,
  workosUserId: "workos_1",
  email: "batman@example.com",
} as Doc<"users">

const OTHER_USER = {
  ...user,
  _id: "users_2" as Id<"users">,
  workosUserId: "workos_2",
  email: "robin@example.com",
} as Doc<"users">
const AUTHORIZATION_SECRET = "test-usage-reservation-secret-with-32-bytes"
const DEPLOYMENT_URL = "https://preview-one.convex.cloud"

const snapshot: PricingSnapshot = {
  revision: "rev-test",
  currency: "USD",
  primary: {
    modelId: "gpt-5-mini",
    routeId: "gpt-5-mini",
    providerId: "openai",
    upstreamModelId: "gpt-5-mini",
    inputCreditsPerMTok: 750_000,
    outputCreditsPerMTok: 4_500_000,
  },
  title: {
    modelId: "gpt-5-mini",
    routeId: "gpt-5-mini",
    providerId: "openai",
    upstreamModelId: "gpt-5-mini",
    inputCreditsPerMTok: 750_000,
    outputCreditsPerMTok: 4_500_000,
  },
}

function reserveArgs(
  overrides: Partial<ReserveUsageArgs> = {}
): ReserveUsageArgs {
  return {
    requestId: "req-1",
    chatId: "chat-1",
    modelId: "gpt-5-mini",
    routeId: "gpt-5-mini",
    providerId: "openai",
    estimatedCredits: 100_000,
    titleEstimatedCredits: 1_000,
    pricingSnapshot: snapshot,
    ...overrides,
  }
}

function authenticatedCtx(ctx: MutationCtx, authenticatedUser = user) {
  return { ...ctx, user: authenticatedUser }
}

function authorizedReserveArgs({
  authenticatedUser = user,
  signedUser = authenticatedUser,
  issuedAt = Date.now(),
  overrides,
  deploymentUrl = DEPLOYMENT_URL,
}: {
  authenticatedUser?: Doc<"users">
  signedUser?: Doc<"users">
  issuedAt?: number
  overrides?: Partial<ReserveUsageArgs>
  deploymentUrl?: string
} = {}): {
  authenticatedUser: Doc<"users">
  args: AuthorizedReserveUsageArgs
} {
  const reservationArgs = reserveArgs(overrides)
  return {
    authenticatedUser,
    args: {
      ...reservationArgs,
      authorizationIssuedAt: issuedAt,
      authorizationProof: signUsageReservationAuthorization(
        {
          ...reservationArgs,
          workosUserId: signedUser.workosUserId,
          deploymentUrl,
          issuedAt,
        },
        AUTHORIZATION_SECRET
      ),
    },
  }
}

function expectNoAllowanceWrites(tables: Tables): void {
  expect(tables.usageBuckets).toHaveLength(0)
  expect(tables.usageReservations).toHaveLength(0)
  expect(tables.usageLedgerEntries).toHaveLength(0)
  expect(tables.apiRateLimits).toHaveLength(0)
}

afterEach(() => {
  vi.unstubAllEnvs()
})

function bucketOf(tables: Tables) {
  expect(tables.usageBuckets).toHaveLength(1)
  return tables.usageBuckets[0]!
}

describe("grant", () => {
  it("materializes exactly one bucket per period with one grant entry", async () => {
    const { ctx, tables } = createCtx({ users: [user] })
    const first = await ensureCurrentUsageBucket(ctx, user, Date.now())
    const second = await ensureCurrentUsageBucket(ctx, user, Date.now())
    expect(second._id).toBe(first._id)
    expect(tables.usageBuckets).toHaveLength(1)
    expect(tables.usageLedgerEntries).toHaveLength(1)
    expect(tables.usageLedgerEntries[0]).toMatchObject({
      type: "grant",
      deltaAvailableCredits: first.grantedCredits,
    })
    expect(first.availableCredits).toBe(first.grantedCredits)
  })
})

describe("reserve", () => {
  it("moves available to reserved and appends the reserve entry", async () => {
    const { ctx, tables } = createCtx({ users: [user] })
    const result = await reserveUsageForUser(ctx, user, reserveArgs())
    expect(result.kind).toBe("reserved")
    const bucket = bucketOf(tables)
    expect(bucket.reservedCredits).toBe(100_000)
    expect(bucket.availableCredits).toBe(bucket.grantedCredits - 100_000)
    expect(
      tables.usageLedgerEntries.filter((entry) => entry.type === "reserve")
    ).toHaveLength(1)
  })

  it("replays an identical duplicate without a second balance change", async () => {
    const { ctx, tables } = createCtx({ users: [user] })
    const first = await reserveUsageForUser(ctx, user, reserveArgs())
    const replay = await reserveUsageForUser(ctx, user, reserveArgs())
    expect(replay).toEqual({
      kind: "idempotent_replay",
      reservationId: (first as { reservationId: string }).reservationId,
    })
    expect(bucketOf(tables).reservedCredits).toBe(100_000)
    expect(tables.usageReservations).toHaveLength(1)
  })

  it("semantically replays and upgrades a reservation with the legacy fingerprint", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined)
    const { ctx, tables } = createCtx({ users: [user] })
    const first = await reserveUsageForUser(ctx, user, reserveArgs())
    tables.usageReservations[0]!.payloadFingerprint = "v2|legacy"

    await expect(
      reserveUsageForUser(ctx, user, reserveArgs())
    ).resolves.toEqual({
      kind: "idempotent_replay",
      reservationId: (first as { reservationId: string }).reservationId,
    })
    expect(tables.usageReservations[0]!.payloadFingerprint).toContain(
      "usage-reservation-fingerprint-v3"
    )
    expect(tables.usageReservations).toHaveLength(1)
    // The in-place upgrade is audited, never silent.
    expect(
      log.mock.calls.some((call) =>
        String(call[0]).includes("usage_reserve_fingerprint_migrated")
      )
    ).toBe(true)
    log.mockRestore()
  })

  it("rejects a reused request id whose payload changed", async () => {
    const { ctx, tables } = createCtx({ users: [user] })
    await reserveUsageForUser(ctx, user, reserveArgs())
    const conflicting = await reserveUsageForUser(
      ctx,
      user,
      reserveArgs({ estimatedCredits: 999 })
    )
    expect(conflicting).toEqual({ kind: "conflict" })
    expect(bucketOf(tables).reservedCredits).toBe(100_000)
  })

  it("denies without changing anything when allowance is insufficient", async () => {
    const { ctx, tables } = createCtx({ users: [user] })
    const bucket = await ensureCurrentUsageBucket(ctx, user, Date.now())
    const result = await reserveUsageForUser(
      ctx,
      user,
      reserveArgs({ estimatedCredits: bucket.grantedCredits + 1 })
    )
    expect(result).toMatchObject({ kind: "insufficient_allowance" })
    expect(bucketOf(tables).reservedCredits).toBe(0)
    expect(tables.usageReservations).toHaveLength(0)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5])(
    "rejects invalid token estimate %s before any write",
    async (estimatedInputTokens) => {
      const { ctx, tables } = createCtx({ users: [user] })

      await expect(
        reserveUsageForUser(ctx, user, reserveArgs({ estimatedInputTokens }))
      ).rejects.toThrow("Invalid usage reservation payload")
      expectNoAllowanceWrites(tables)
    }
  )

  it("cannot double-admit two reservations past the balance", async () => {
    // Serializable mutations: the second reservation sees the first's
    // committed balance. Combined value exceeds the grant → exactly one wins.
    const { ctx, tables } = createCtx({ users: [user] })
    const bucket = await ensureCurrentUsageBucket(ctx, user, Date.now())
    const each = Math.floor((bucket.grantedCredits * 2) / 3)
    const first = await reserveUsageForUser(
      ctx,
      user,
      reserveArgs({ requestId: "req-a", estimatedCredits: each })
    )
    const second = await reserveUsageForUser(
      ctx,
      user,
      reserveArgs({ requestId: "req-b", estimatedCredits: each })
    )
    expect(first.kind).toBe("reserved")
    expect(second).toMatchObject({ kind: "insufficient_allowance" })
    expect(bucketOf(tables).reservedCredits).toBe(each)
  })

  it("blocks new reservations while the balance is negative", async () => {
    const { ctx, tables } = createCtx({ users: [user] })
    const run = await reservedRunFixture(ctx, {
      workStartedAt: 1,
    })
    // Overrun: actual far above the grant drives the balance negative.
    await settleUsageForTerminalRun(ctx, run, {
      usage: { inputTokens: 2_000_000_000, outputTokens: 0 },
      titleUsage: "not-run",
    })
    expect(bucketOf(tables).availableCredits).toBeLessThan(0)
    const denied = await reserveUsageForUser(
      ctx,
      user,
      reserveArgs({ requestId: "req-after", estimatedCredits: 0 })
    )
    expect(denied).toMatchObject({ kind: "insufficient_allowance" })
  })
})

/** Reserve + attach one reservation to a run doc; returns the run. */
async function reservedRunFixture(
  ctx: MutationCtx,
  runFields: Partial<Doc<"generationRuns">> = {}
): Promise<Doc<"generationRuns">> {
  const reserved = await reserveUsageForUser(ctx, user, reserveArgs())
  expect(reserved.kind).toBe("reserved")
  const reservationId = (reserved as { reservationId: Id<"usageReservations"> })
    .reservationId
  const runId = (await ctx.db.insert("generationRuns", {
    chatId: "chats_1" as Id<"chats">,
    userId: user._id,
    requestId: "req-1",
    model: "gpt-5-mini",
    provider: "openai",
    status: "streaming",
    updatedAt: Date.now(),
    ...runFields,
  } as never)) as Id<"generationRuns">
  await attachReservationToRun(ctx, {
    reservationId,
    requestId: "req-1",
    userId: user._id,
    runId,
    now: Date.now(),
  })
  const run = await ctx.db.get(runId)
  if (!run) throw new Error("run fixture missing")
  return run
}

describe("settlement", () => {
  it("releases in full when provider work never started", async () => {
    const { ctx, tables } = createCtx({ users: [user] })
    const run = await reservedRunFixture(ctx, {
      workStartedAt: undefined,
    })
    await settleUsageForTerminalRun(ctx, run, {}, "failed")
    const bucket = bucketOf(tables)
    expect(bucket.reservedCredits).toBe(0)
    expect(bucket.spentCredits).toBe(0)
    expect(bucket.availableCredits).toBe(bucket.grantedCredits)
    expect(tables.usageReservations[0]).toMatchObject({ status: "released" })
  })

  it("settles below the reservation and refunds the difference", async () => {
    const { ctx, tables } = createCtx({ users: [user] })
    const run = await reservedRunFixture(ctx, { workStartedAt: 1 })
    // 1000 in / 100 out at the fixture rates: ceil(0.75M*1e3/1e6)=750 +
    // ceil(4.5M*1e2/1e6)=450 → 1200 credits, well below the 100k reserved.
    await settleUsageForTerminalRun(ctx, run, {
      usage: { inputTokens: 1_000, outputTokens: 100 },
      titleUsage: "not-run",
    })
    const bucket = bucketOf(tables)
    expect(bucket.spentCredits).toBe(1_200)
    expect(bucket.reservedCredits).toBe(0)
    expect(bucket.availableCredits).toBe(bucket.grantedCredits - 1_200)
    expect(tables.usageReservations[0]).toMatchObject({
      status: "settled",
      settlementBasis: "actual",
      actualCredits: 1_200,
    })
  })

  it("settles above the reservation into a recorded negative balance", async () => {
    const { ctx, tables } = createCtx({ users: [user] })
    const run = await reservedRunFixture(ctx, { workStartedAt: 1 })
    await settleUsageForTerminalRun(ctx, run, {
      usage: { inputTokens: 2_000_000_000, outputTokens: 0 },
      titleUsage: "not-run",
    })
    const bucket = bucketOf(tables)
    const actual = tables.usageReservations[0]!.actualCredits!
    expect(actual).toBeGreaterThan(bucket.grantedCredits)
    expect(bucket.spentCredits).toBe(actual)
    expect(bucket.availableCredits).toBe(bucket.grantedCredits - actual)
    expect(bucket.availableCredits).toBeLessThan(0)
  })

  it("marks unknown title usage as an estimated-title settlement", async () => {
    const { ctx, tables } = createCtx({ users: [user] })
    const run = await reservedRunFixture(ctx, { workStartedAt: 1 })
    await settleUsageForTerminalRun(ctx, run, {
      usage: { inputTokens: 1_000, outputTokens: 100 },
      titleUsage: "unknown",
    })
    expect(tables.usageReservations[0]).toMatchObject({
      settlementBasis: "actual_with_estimated_title",
      titleCredits: 1_000,
      actualCredits: 2_200,
    })
  })

  it("includes observed title usage at the title route's rates", async () => {
    const { ctx, tables } = createCtx({ users: [user] })
    const run = await reservedRunFixture(ctx, { workStartedAt: 1 })
    await settleUsageForTerminalRun(ctx, run, {
      usage: { inputTokens: 1_000, outputTokens: 100 },
      // 400 in / 8 out → ceil(300)=300 + ceil(36)=36 = 336 credits.
      titleUsage: { inputTokens: 400, outputTokens: 8 },
    })
    expect(tables.usageReservations[0]).toMatchObject({
      settlementBasis: "actual",
      titleCredits: 336,
      actualCredits: 1_536,
    })
  })

  it("settles observed per-step usage when the aggregate never arrived", async () => {
    const { ctx, tables } = createCtx({ users: [user] })
    const run = await reservedRunFixture(ctx, {
      workStartedAt: 1,
      inputTokens: 1_000,
      outputTokens: 100,
    })
    await settleUsageForTerminalRun(ctx, run, {}, "aborted")
    expect(tables.usageReservations[0]).toMatchObject({
      status: "settled",
      settlementBasis: "observed_partial",
      actualCredits: 1_200 + 1_000, // observed + conservative title estimate
    })
  })

  it("settles the reserved estimate when no usage evidence survived", async () => {
    const { ctx, tables } = createCtx({ users: [user] })
    const run = await reservedRunFixture(ctx, { workStartedAt: 1 })
    await settleUsageForTerminalRun(ctx, run, {}, "lease_expired")
    const bucket = bucketOf(tables)
    expect(tables.usageReservations[0]).toMatchObject({
      status: "settled",
      settlementBasis: "estimated_after_unknown_usage",
      actualCredits: 100_000,
    })
    expect(bucket.spentCredits).toBe(100_000)
    expect(bucket.availableCredits).toBe(bucket.grantedCredits - 100_000)
  })

  it("absorbs duplicate terminal delivery without a second charge", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const { ctx, tables } = createCtx({ users: [user] })
    const run = await reservedRunFixture(ctx, { workStartedAt: 1 })
    await settleUsageForTerminalRun(ctx, run, {
      usage: { inputTokens: 1_000, outputTokens: 100 },
      titleUsage: "not-run",
    })
    const spentAfterFirst = bucketOf(tables).spentCredits
    // Same facts re-delivered (reaper/verdict race): benign, silent.
    await settleUsageForTerminalRun(ctx, run, {
      usage: { inputTokens: 1_000, outputTokens: 100 },
      titleUsage: "not-run",
    })
    // Evidence-free re-delivery is equally benign.
    await settleUsageForTerminalRun(ctx, run, {}, "reconciled_terminal_run")
    expect(bucketOf(tables).spentCredits).toBe(spentAfterFirst)
    expect(
      tables.usageLedgerEntries.filter((e) => e.type === "settle")
    ).toHaveLength(1)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("logs a conflicting second settlement and keeps the first", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const { ctx, tables } = createCtx({ users: [user] })
    const run = await reservedRunFixture(ctx, { workStartedAt: 1 })
    await settleUsageForTerminalRun(ctx, run, {
      usage: { inputTokens: 1_000, outputTokens: 100 },
      titleUsage: "not-run",
    })
    const spentAfterFirst = bucketOf(tables).spentCredits
    // A second settlement whose evidence DISAGREES: rejected, never re-billed,
    // logged as an invariant violation (ADR-0021).
    await settleUsageForTerminalRun(ctx, run, {
      usage: { inputTokens: 9_999_999, outputTokens: 9_999_999 },
      titleUsage: "not-run",
    })
    expect(bucketOf(tables).spentCredits).toBe(spentAfterFirst)
    expect(
      tables.usageLedgerEntries.filter((e) => e.type === "settle")
    ).toHaveLength(1)
    expect(
      warn.mock.calls.some((call) =>
        String(call[0]).includes("usage_settle_conflict_rejected")
      )
    ).toBe(true)
    warn.mockRestore()
  })

  it("rejects settle-after-release as an invariant violation", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const { ctx, tables } = createCtx({ users: [user] })
    const reserved = await reserveUsageForUser(ctx, user, reserveArgs())
    expect(reserved.kind).toBe("reserved")
    await releaseUnattachedForUser(ctx, user, "req-1")
    expect(tables.usageReservations[0]).toMatchObject({ status: "released" })

    // A run later claims the released reservation's terminal — must reject.
    const runId = (await ctx.db.insert("generationRuns", {
      chatId: "chats_1",
      userId: user._id,
      requestId: "req-1",
      model: "gpt-5-mini",
      provider: "openai",
      status: "completed",
      workStartedAt: 1,
      updatedAt: Date.now(),
    } as never)) as Id<"generationRuns">
    await ctx.db.patch(tables.usageReservations[0]!._id, {
      generationRunId: runId,
    })
    const run = await ctx.db.get(runId)
    await settleUsageForTerminalRun(ctx, run!, {
      usage: { inputTokens: 1, outputTokens: 1 },
    })
    expect(tables.usageReservations[0]).toMatchObject({ status: "released" })
    expect(bucketOf(tables).spentCredits).toBe(0)
    expect(
      warn.mock.calls.some((call) =>
        String(call[0]).includes("usage_settle_after_release_rejected")
      )
    ).toBe(true)
    warn.mockRestore()
  })

  it("refuses release after settlement", async () => {
    const { ctx, tables } = createCtx({ users: [user] })
    const run = await reservedRunFixture(ctx, { workStartedAt: 1 })
    await settleUsageForTerminalRun(ctx, run, {
      usage: { inputTokens: 1_000, outputTokens: 100 },
      titleUsage: "not-run",
    })
    const spent = bucketOf(tables).spentCredits
    // releaseUnattached refuses both settled status AND attached rows.
    await expect(releaseUnattachedForUser(ctx, user, "req-1")).resolves.toEqual(
      { released: false }
    )
    expect(bucketOf(tables).spentCredits).toBe(spent)
  })
})

describe("settlement evidence beats a missing work-start marker", () => {
  it("settles actual usage even when the work-start write never landed", async () => {
    // workStartedAt rides a best-effort fire-and-forget write; its absence
    // must never refund a run that provably consumed usage.
    const { ctx, tables } = createCtx({ users: [user] })
    const run = await reservedRunFixture(ctx, { workStartedAt: undefined })
    await settleUsageForTerminalRun(ctx, run, {
      usage: { inputTokens: 1_000, outputTokens: 100 },
      titleUsage: "not-run",
    })
    expect(tables.usageReservations[0]).toMatchObject({
      status: "settled",
      settlementBasis: "actual",
      actualCredits: 1_200,
    })
  })

  it("settles accumulated per-step usage even without the marker", async () => {
    const { ctx, tables } = createCtx({ users: [user] })
    const run = await reservedRunFixture(ctx, {
      workStartedAt: undefined,
      inputTokens: 1_000,
      outputTokens: 100,
    })
    await settleUsageForTerminalRun(ctx, run, {}, "aborted")
    expect(tables.usageReservations[0]).toMatchObject({
      status: "settled",
      settlementBasis: "observed_partial",
    })
  })
})

describe("provider rejection before any output", () => {
  it("releases when a provider_error run streamed nothing", async () => {
    // Instant 400/401/429: workStartedAt is stamped just before the provider
    // call, but zero content checkpoints means nothing billable happened —
    // failed requests are not billed.
    const { ctx, tables } = createCtx({ users: [user] })
    const run = await reservedRunFixture(ctx, {
      workStartedAt: 1,
      lastSnapshotSequence: undefined,
    })
    // Live path: the caller passes the verdict's terminal reason explicitly
    // (its in-memory run doc predates the terminal patch).
    await settleUsageForTerminalRun(
      ctx,
      run,
      {},
      "provider_error",
      "provider_error"
    )
    const bucket = bucketOf(tables)
    expect(tables.usageReservations[0]).toMatchObject({
      status: "released",
      terminalReason: "provider_error_before_output",
    })
    expect(bucket.spentCredits).toBe(0)
    expect(bucket.availableCredits).toBe(bucket.grantedCredits)
  })

  it("keeps the conservative estimate once content ever streamed", async () => {
    const { ctx, tables } = createCtx({ users: [user] })
    const run = await reservedRunFixture(ctx, {
      workStartedAt: 1,
      lastSnapshotSequence: 3,
    })
    await settleUsageForTerminalRun(
      ctx,
      run,
      {},
      "provider_error",
      "provider_error"
    )
    expect(tables.usageReservations[0]).toMatchObject({
      status: "settled",
      settlementBasis: "estimated_after_unknown_usage",
    })
  })

  it("never applies the rejection release to a user Stop", async () => {
    const { ctx, tables } = createCtx({ users: [user] })
    const run = await reservedRunFixture(ctx, { workStartedAt: 1 })
    await settleUsageForTerminalRun(ctx, run, {}, "user_stop", "user_stop")
    expect(tables.usageReservations[0]).toMatchObject({
      status: "settled",
      settlementBasis: "estimated_after_unknown_usage",
    })
  })
})

describe("title evidence edge cases", () => {
  it("treats a title usage object without token counts as estimated", async () => {
    const { ctx, tables } = createCtx({ users: [user] })
    const run = await reservedRunFixture(ctx, { workStartedAt: 1 })
    await settleUsageForTerminalRun(ctx, run, {
      usage: { inputTokens: 1_000, outputTokens: 100 },
      titleUsage: {},
    })
    expect(tables.usageReservations[0]).toMatchObject({
      settlementBasis: "actual_with_estimated_title",
      titleCredits: 1_000,
    })
  })
})

describe("reserve hardening", () => {
  it("rejects a replay of a settled or released reservation", async () => {
    const { ctx } = createCtx({ users: [user] })
    await reserveUsageForUser(ctx, user, reserveArgs())
    await releaseUnattachedForUser(ctx, user, "req-1")
    const replay = await reserveUsageForUser(ctx, user, reserveArgs())
    expect(replay).toEqual({ kind: "conflict" })
  })

  it("throttles a reservation flood without touching balances", async () => {
    // This invokes the trusted core after the public wrapper's signed
    // authorization boundary, tested separately below.
    // Freeze the clock so all 40 attempts land in ONE fixed window.
    vi.useFakeTimers()
    vi.setSystemTime(1_787_200_000_000)
    try {
      const { ctx, tables } = createCtx({ users: [user] })
      let rateLimited = 0
      for (let index = 0; index < 40; index++) {
        const result = await reserveUsageForUser(
          ctx,
          user,
          reserveArgs({ requestId: `req-flood-${index}`, estimatedCredits: 0 })
        )
        if (result.kind === "rate_limited") rateLimited++
      }
      expect(rateLimited).toBe(10) // 30/minute window
      expect(tables.usageReservations).toHaveLength(30)
      expect(bucketOf(tables).reservedCredits).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("reserve authorization boundary", () => {
  it("accepts and idempotently replays a proof for the authenticated user and deployment", async () => {
    vi.stubEnv("CHAT_ADMISSION_SECRET", AUTHORIZATION_SECRET)
    vi.stubEnv("CONVEX_CLOUD_URL", DEPLOYMENT_URL)
    const { ctx, tables } = createCtx({ users: [user] })
    const authorized = authorizedReserveArgs()

    const authenticated = authenticatedCtx(ctx, authorized.authenticatedUser)
    const first = await reserveAuthorizedHandler(authenticated, authorized.args)
    expect(first).toMatchObject({ kind: "reserved" })
    await expect(
      reserveAuthorizedHandler(authenticated, authorized.args)
    ).resolves.toEqual({
      kind: "idempotent_replay",
      reservationId: (first as { reservationId: string }).reservationId,
    })
    expect(tables.usageReservations).toHaveLength(1)
  })

  it.each([
    {
      name: "malformed proof",
      build: () => {
        const authorized = authorizedReserveArgs()
        return {
          ...authorized,
          args: { ...authorized.args, authorizationProof: "not-a-proof" },
        }
      },
    },
    {
      name: "another WorkOS subject",
      build: () =>
        authorizedReserveArgs({
          authenticatedUser: OTHER_USER,
          signedUser: user,
        }),
    },
    {
      name: "expired timestamp",
      build: () => authorizedReserveArgs({ issuedAt: Date.now() - 60_001 }),
    },
    {
      name: "tampered reservation field",
      build: () => {
        const authorized = authorizedReserveArgs()
        return {
          ...authorized,
          args: { ...authorized.args, estimatedCredits: 1 },
        }
      },
    },
    {
      name: "another deployment",
      build: () =>
        authorizedReserveArgs({
          deploymentUrl: "https://preview-two.convex.cloud",
        }),
    },
  ])("rejects $name before any allowance write", async ({ build }) => {
    vi.stubEnv("CHAT_ADMISSION_SECRET", AUTHORIZATION_SECRET)
    vi.stubEnv("CONVEX_CLOUD_URL", DEPLOYMENT_URL)
    const { ctx, tables } = createCtx({ users: [user, OTHER_USER] })
    const unauthorized = build()

    await expect(
      reserveAuthorizedHandler(
        authenticatedCtx(ctx, unauthorized.authenticatedUser),
        unauthorized.args
      )
    ).rejects.toThrow("Invalid usage reservation authorization")
    expectNoAllowanceWrites(tables)
  })

})

describe("attach", () => {
  it("refuses a reservation that does not match the request", async () => {
    const { ctx } = createCtx({ users: [user] })
    const reserved = await reserveUsageForUser(ctx, user, reserveArgs())
    const reservationId = (
      reserved as { reservationId: Id<"usageReservations"> }
    ).reservationId
    await expect(
      attachReservationToRun(ctx, {
        reservationId,
        requestId: "some-other-request",
        userId: user._id,
        runId: "generationRuns_9" as Id<"generationRuns">,
        now: Date.now(),
      })
    ).rejects.toThrow("cannot be attached")
  })
})

describe("reconciler", () => {
  it("releases stale unattached rows and settles terminal-run strands", async () => {
    const { ctx, tables } = createCtx({ users: [user] })
    // Stale unattached reservation.
    await reserveUsageForUser(
      ctx,
      user,
      reserveArgs({ requestId: "req-unattached" })
    )
    // Stale attached reservation whose run reached terminal unsettled.
    const run = await reservedRunFixture(ctx, {
      workStartedAt: 1,
      status: "failed",
    })
    // Stale attached reservation on a STILL-LIVE run — must be skipped.
    const liveReserved = await reserveUsageForUser(
      ctx,
      user,
      reserveArgs({ requestId: "req-live" })
    )
    const liveRunId = (await ctx.db.insert("generationRuns", {
      chatId: "chats_1",
      userId: user._id,
      requestId: "req-live",
      model: "gpt-5-mini",
      provider: "openai",
      status: "streaming",
      workStartedAt: 1,
      updatedAt: Date.now(),
    } as never)) as Id<"generationRuns">
    await attachReservationToRun(ctx, {
      reservationId: (
        liveReserved as { reservationId: Id<"usageReservations"> }
      ).reservationId,
      requestId: "req-live",
      userId: user._id,
      runId: liveRunId,
      now: Date.now(),
    })

    // Age every reservation past the stale threshold.
    for (const reservation of tables.usageReservations) {
      await ctx.db.patch(reservation._id, {
        reservedAt: Date.now() - STALE_RESERVATION_MS - 1,
      })
    }

    const { reconciled, skipped } =
      await reconcileStaleUsageReservationsPass(ctx)
    expect(reconciled).toBe(2)
    expect(skipped).toBe(1)

    const byRequest = new Map(
      tables.usageReservations.map((row) => [row.requestId, row])
    )
    expect(byRequest.get("req-unattached")).toMatchObject({
      status: "released",
    })
    expect(byRequest.get(run.requestId)).toMatchObject({ status: "settled" })
    expect(byRequest.get("req-live")).toMatchObject({ status: "reserved" })

    // Idempotent: a second pass changes nothing.
    const second = await reconcileStaleUsageReservationsPass(ctx)
    expect(second.reconciled).toBe(0)
  })

  it("applies the provider-error release to a stale failed-before-output run", async () => {
    // A run that died on an instant 400/401/429 whose live settlement was
    // lost: the boundary rule must read the run's stored terminalReason and
    // release, not settle the full estimate (over-charging for an outage).
    const { ctx, tables } = createCtx({ users: [user] })
    await reservedRunFixture(ctx, {
      workStartedAt: 1,
      status: "failed",
      terminalReason: "provider_error",
      lastSnapshotSequence: undefined,
    })
    await ctx.db.patch(tables.usageReservations[0]!._id, {
      reservedAt: Date.now() - STALE_RESERVATION_MS - 1,
    })

    const { reconciled } = await reconcileStaleUsageReservationsPass(ctx)
    expect(reconciled).toBe(1)
    expect(tables.usageReservations[0]).toMatchObject({
      status: "released",
      terminalReason: "provider_error_before_output",
    })
    const bucket = bucketOf(tables)
    expect(bucket.spentCredits).toBe(0)
    expect(bucket.availableCredits).toBe(bucket.grantedCredits)
  })
})
