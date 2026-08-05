import { v } from "convex/values"
import { authenticatedMutation } from "./lib/authedFunctions"

/**
 * Per-identity fixed-window rate limiter for expensive API routes.
 *
 * Distinct from `toolLimits` (a sliding-window, tool/domain/budget-scoped
 * limiter for in-chat tool calls): this is a simple request throttle keyed to
 * the authenticated caller, for HTTP endpoints that do real work per call — the
 * MCP "test connection" route opens an outbound socket every time, so it needs a
 * ceiling that can't be lifted by a client-supplied key.
 *
 * The actor key is derived from `ctx.user` (never a client argument), so a caller
 * cannot throttle-evade by spoofing an id. Policy is resolved by allowlisted
 * bucket on the server, so public mutation callers cannot reset allowance by
 * choosing a different limit or window. Stale buckets for this actor are swept
 * opportunistically on write so the table stays bounded without a cron.
 */

export const API_RATE_LIMIT_POLICIES = {
  mcp_test: { limit: 10, windowMs: 60_000 },
  profile_image_upload: { limit: 10, windowMs: 60_000 },
} as const

export type RateLimitBucket = keyof typeof API_RATE_LIMIT_POLICIES

const rateLimitBucketValidator = v.union(
  v.literal("mcp_test"),
  v.literal("profile_image_upload")
)

export function getRateLimitPolicy(bucket: RateLimitBucket): {
  limit: number
  windowMs: number
} {
  return API_RATE_LIMIT_POLICIES[bucket]
}

export type WindowBucket<Id> = {
  _id: Id
  windowStartMs: number
  count: number
}

export type FixedWindowDecision<Id> = {
  windowStartMs: number
  allowed: boolean
  remaining: number
  retryAfterMs: number
  /** Buckets from prior windows that can be deleted. */
  staleBucketIds: Id[]
  /** The current window's bucket, if one already exists. */
  currentBucketId: Id | null
  currentCount: number
}

/**
 * Pure fixed-window decision over a set of buckets for one actor+bucket. Kept
 * separate from the Convex I/O so the throttle arithmetic is unit-testable.
 */
export function evaluateFixedWindow<Id>(
  buckets: WindowBucket<Id>[],
  { now, limit, windowMs }: { now: number; limit: number; windowMs: number }
): FixedWindowDecision<Id> {
  if (limit <= 0 || windowMs <= 0) {
    throw new Error("Invalid rate-limit configuration")
  }

  const windowStartMs = Math.floor(now / windowMs) * windowMs
  const staleBucketIds = buckets
    .filter((b) => b.windowStartMs < windowStartMs)
    .map((b) => b._id)

  const current = buckets.find((b) => b.windowStartMs === windowStartMs)
  const currentCount = current?.count ?? 0

  if (currentCount >= limit) {
    return {
      windowStartMs,
      allowed: false,
      remaining: 0,
      retryAfterMs: windowStartMs + windowMs - now,
      staleBucketIds,
      currentBucketId: current?._id ?? null,
      currentCount,
    }
  }

  return {
    windowStartMs,
    allowed: true,
    remaining: limit - currentCount - 1,
    retryAfterMs: 0,
    staleBucketIds,
    currentBucketId: current?._id ?? null,
    currentCount,
  }
}

export const consume = authenticatedMutation({
  args: {
    bucket: rateLimitBucketValidator,
  },
  handler: async (ctx, { bucket }) => {
    const actorKey = `user:${ctx.user._id}`
    const { limit, windowMs } = getRateLimitPolicy(bucket)

    const buckets = await ctx.db
      .query("apiRateLimits")
      .withIndex("by_actor_bucket_window", (q) =>
        q.eq("actorKey", actorKey).eq("bucket", bucket)
      )
      .collect()

    const decision = evaluateFixedWindow(buckets, {
      now: Date.now(),
      limit,
      windowMs,
    })

    await Promise.all(decision.staleBucketIds.map((id) => ctx.db.delete(id)))

    if (!decision.allowed) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: decision.retryAfterMs,
      }
    }

    if (decision.currentBucketId) {
      await ctx.db.patch(decision.currentBucketId, {
        count: decision.currentCount + 1,
      })
    } else {
      await ctx.db.insert("apiRateLimits", {
        actorKey,
        bucket,
        windowStartMs: decision.windowStartMs,
        count: 1,
      })
    }

    return {
      allowed: true,
      remaining: decision.remaining,
      retryAfterMs: 0,
    }
  },
})
