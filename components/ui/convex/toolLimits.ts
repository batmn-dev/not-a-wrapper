import { v } from "convex/values"
import { mutation } from "./_generated/server"

const MAX_SCOPE_ITEMS = 25

function sanitizeScopeCount(count: number): number {
  if (!Number.isFinite(count)) return 1
  const normalized = Math.trunc(count)
  return normalized > 0 ? normalized : 1
}

function toRetryAfterSeconds(retryAfterMs: number): number {
  return Math.max(1, Math.ceil(retryAfterMs / 1000))
}

function formatDomainLimitCode(toolName: string): `${string}_DOMAIN_LIMIT_EXCEEDED` {
  const normalizedToolName = toolName
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase()

  return `${normalizedToolName || "TOOL"}_DOMAIN_LIMIT_EXCEEDED`
}

export const checkAndConsume = mutation({
  args: {
    limitType: v.union(v.literal("domain"), v.literal("budget")),
    toolName: v.string(),
    keyMode: v.union(v.literal("platform"), v.literal("byok")),
    scopeCounts: v.array(
      v.object({
        scopeKey: v.string(),
        count: v.number(),
      })
    ),
    windowMs: v.number(),
    maxCount: v.number(),
    bucketSizeMs: v.number(),
    anonymousId: v.optional(v.string()),
    consume: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const {
      limitType,
      toolName,
      keyMode,
      scopeCounts,
      windowMs,
      maxCount,
      bucketSizeMs,
      anonymousId,
      consume = true,
    } = args

    if (scopeCounts.length === 0) {
      return { allowed: true, remaining: maxCount }
    }

    if (scopeCounts.length > MAX_SCOPE_ITEMS) {
      throw new Error(`Too many scopes (${scopeCounts.length}); max ${MAX_SCOPE_ITEMS}`)
    }

    if (windowMs <= 0 || maxCount <= 0 || bucketSizeMs <= 0) {
      throw new Error("Invalid limit configuration")
    }

    const identity = await ctx.auth.getUserIdentity()
    let actorKey: string
    if (identity) {
      actorKey = `user:${identity.subject}`
    } else {
      if (!anonymousId) {
        throw new Error("Anonymous ID required for unauthenticated tool limits")
      }
      actorKey = `guest:${anonymousId}`
    }

    const now = Date.now()
    const currentBucketStartMs =
      Math.floor(now / bucketSizeMs) * bucketSizeMs
    const windowStartMs = now - windowMs + 1
    const firstBucketStartMs =
      Math.floor(windowStartMs / bucketSizeMs) * bucketSizeMs

    const normalizedScopes = scopeCounts.map((scope) => ({
      scopeKey: scope.scopeKey,
      count: sanitizeScopeCount(scope.count),
    }))

    const scopedTotals: Array<{
      scopeKey: string
      total: number
      projected: number
      count: number
      oldestBucketStartMs?: number
    }> = []

    for (const scope of normalizedScopes) {
      const buckets = await ctx.db
        .query("toolLimitBuckets")
        .withIndex("by_actor_limit_scope_bucket", (q) =>
          q
            .eq("actorKey", actorKey)
            .eq("limitType", limitType)
            .eq("toolName", toolName)
            .eq("scopeKey", scope.scopeKey)
            .eq("keyMode", keyMode)
            .gte("bucketStartMs", firstBucketStartMs)
            .lte("bucketStartMs", currentBucketStartMs)
        )
        .collect()

      const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0)
      const projected = total + scope.count
      const oldestBucketStartMs = buckets
        .filter((bucket) => bucket.count > 0)
        .sort((a, b) => a.bucketStartMs - b.bucketStartMs)[0]?.bucketStartMs

      scopedTotals.push({
        scopeKey: scope.scopeKey,
        total,
        projected,
        count: scope.count,
        oldestBucketStartMs,
      })
    }

    const denied = scopedTotals.find((scope) => scope.projected > maxCount)
    if (denied) {
      const retryAfterMs = denied.oldestBucketStartMs
        ? Math.max(
            1_000,
            denied.oldestBucketStartMs + bucketSizeMs + windowMs - now
          )
        : windowMs

      if (limitType === "domain") {
        return {
          allowed: false,
          code: formatDomainLimitCode(toolName),
          message:
            `Too many "${toolName}" requests for domain "${denied.scopeKey}" in the active window.`,
          retryAfterSeconds: toRetryAfterSeconds(retryAfterMs),
          scopeKey: denied.scopeKey,
          remaining: Math.max(0, maxCount - denied.total),
        }
      }

      return {
        allowed: false,
        code: "TOOL_BUDGET_EXCEEDED",
        message:
          `Tool budget exceeded for "${toolName}" (${keyMode} key mode) in the active window.`,
        retryAfterSeconds: toRetryAfterSeconds(retryAfterMs),
        scopeKey: denied.scopeKey,
        remaining: Math.max(0, maxCount - denied.total),
      }
    }

    if (consume) {
      for (const scope of scopedTotals) {
        const existing = await ctx.db
          .query("toolLimitBuckets")
          .withIndex("by_actor_limit_scope_bucket", (q) =>
            q
              .eq("actorKey", actorKey)
              .eq("limitType", limitType)
              .eq("toolName", toolName)
              .eq("scopeKey", scope.scopeKey)
              .eq("keyMode", keyMode)
              .eq("bucketStartMs", currentBucketStartMs)
          )
          .unique()

        if (existing) {
          await ctx.db.patch(existing._id, {
            count: existing.count + scope.count,
            updatedAt: now,
          })
        } else {
          await ctx.db.insert("toolLimitBuckets", {
            actorKey,
            limitType,
            toolName,
            scopeKey: scope.scopeKey,
            keyMode,
            bucketStartMs: currentBucketStartMs,
            count: scope.count,
            updatedAt: now,
          })
        }
      }
    }

    const remaining = scopedTotals.reduce(
      (min, scope) => Math.min(min, maxCount - scope.projected),
      maxCount
    )

    return { allowed: true, remaining: Math.max(0, remaining) }
  },
})
