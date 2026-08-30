import { v } from "convex/values"
import type { Doc } from "./_generated/dataModel"
import type { MutationCtx } from "./_generated/server"
import { optionalAuthMutation, optionalAuthQuery } from "./lib/authedFunctions"

/**
 * Daily message counters — ABUSE RATE LIMITS ONLY (ADR-0021).
 *
 * These counters protect the application from request abuse; they are NOT the
 * economic admission system. Platform-funded spend is admitted by the atomic
 * allowance reservation in convex/usageAllowance.ts, and BYOK messages bypass
 * allowance entirely while still counting here as ordinary requests.
 *
 * The retired pro-model fields stay optional in the schema only until
 * production preflight proves older user rows can be contracted safely.
 */

const NON_AUTH_DAILY_MESSAGE_LIMIT = 5
const AUTH_DAILY_MESSAGE_LIMIT = 1000
const USAGE_ERROR_CODES = {
  ANONYMOUS_ID_REQUIRED: "ANONYMOUS_ID_REQUIRED",
  USER_NOT_FOUND: "USER_NOT_FOUND",
} as const

function getStartOfDayMs(): number {
  const startOfDay = new Date()
  startOfDay.setUTCHours(0, 0, 0, 0)
  return startOfDay.getTime()
}

type AbuseAdmissionCtx = Pick<MutationCtx, "db"> & {
  identity: Awaited<ReturnType<MutationCtx["auth"]["getUserIdentity"]>>
  user: Doc<"users"> | null
}

/**
 * Check if user has reached their daily limit
 *
 * For unauthenticated users, pass an anonymousId (generated client-side and
 * persisted in localStorage) to track their usage across requests.
 */
export const checkUsage = optionalAuthQuery({
  args: {
    anonymousId: v.optional(v.string()),
  },
  handler: async (ctx, { anonymousId }) => {
    const startOfDayMs = getStartOfDayMs()

    if (!ctx.identity) {
      // If no anonymousId provided, we can't track usage - deny by default for safety
      if (!anonymousId) {
        return {
          canSend: false,
          remaining: 0,
          limit: NON_AUTH_DAILY_MESSAGE_LIMIT,
          isAnonymous: true,
          error: "Anonymous ID required for usage tracking",
          errorCode: USAGE_ERROR_CODES.ANONYMOUS_ID_REQUIRED,
        }
      }

      const anonUsage = await ctx.db
        .query("anonymousUsage")
        .withIndex("by_anonymous_id", (q) => q.eq("anonymousId", anonymousId))
        .unique()

      if (!anonUsage) {
        return {
          canSend: true,
          remaining: NON_AUTH_DAILY_MESSAGE_LIMIT,
          limit: NON_AUTH_DAILY_MESSAGE_LIMIT,
          count: 0,
          isAnonymous: true,
        }
      }

      const isNewDay = anonUsage.dailyReset < startOfDayMs
      const count = isNewDay ? 0 : anonUsage.dailyMessageCount
      const remaining = Math.max(0, NON_AUTH_DAILY_MESSAGE_LIMIT - count)

      return {
        canSend: count < NON_AUTH_DAILY_MESSAGE_LIMIT,
        remaining,
        limit: NON_AUTH_DAILY_MESSAGE_LIMIT,
        count,
        isAnonymous: true,
      }
    }

    const user = ctx.user

    if (!user) {
      return {
        canSend: false,
        remaining: 0,
        limit: 0,
        error: "User not found",
        errorCode: USAGE_ERROR_CODES.USER_NOT_FOUND,
      }
    }

    const limit = user.anonymous
      ? NON_AUTH_DAILY_MESSAGE_LIMIT
      : AUTH_DAILY_MESSAGE_LIMIT
    const lastReset = user.dailyReset ?? 0
    const isNewDay = lastReset < startOfDayMs
    const count = isNewDay ? 0 : (user.dailyMessageCount ?? 0)
    const remaining = Math.max(0, limit - count)

    return {
      canSend: count < limit,
      remaining,
      limit,
      count,
      isAnonymous: user.anonymous,
    }
  },
})

/** Check and increment the daily abuse counter in one Convex transaction. */
export async function admitUsageHandler(
  ctx: AbuseAdmissionCtx,
  { anonymousId }: { anonymousId?: string }
) {
  const startOfDayMs = getStartOfDayMs()

  if (!ctx.identity) {
    if (!anonymousId) {
      return {
        canSend: false,
        remaining: 0,
        limit: NON_AUTH_DAILY_MESSAGE_LIMIT,
        isAnonymous: true,
        error: "Anonymous ID required for usage tracking",
        errorCode: USAGE_ERROR_CODES.ANONYMOUS_ID_REQUIRED,
      }
    }

    const anonUsage = await ctx.db
      .query("anonymousUsage")
      .withIndex("by_anonymous_id", (q) => q.eq("anonymousId", anonymousId))
      .unique()

    if (!anonUsage) {
      await ctx.db.insert("anonymousUsage", {
        anonymousId,
        dailyMessageCount: 1,
        dailyReset: startOfDayMs,
      })
      return {
        canSend: true,
        remaining: NON_AUTH_DAILY_MESSAGE_LIMIT - 1,
        limit: NON_AUTH_DAILY_MESSAGE_LIMIT,
        count: 1,
        isAnonymous: true,
      }
    }

    const isNewDay = anonUsage.dailyReset < startOfDayMs
    const count = isNewDay ? 0 : anonUsage.dailyMessageCount
    if (count >= NON_AUTH_DAILY_MESSAGE_LIMIT) {
      return {
        canSend: false,
        remaining: 0,
        limit: NON_AUTH_DAILY_MESSAGE_LIMIT,
        count,
        isAnonymous: true,
      }
    }

    const nextCount = count + 1
    await ctx.db.patch(anonUsage._id, {
      dailyMessageCount: nextCount,
      dailyReset: isNewDay ? startOfDayMs : anonUsage.dailyReset,
    })
    return {
      canSend: true,
      remaining: NON_AUTH_DAILY_MESSAGE_LIMIT - nextCount,
      limit: NON_AUTH_DAILY_MESSAGE_LIMIT,
      count: nextCount,
      isAnonymous: true,
    }
  }

  const user = ctx.user

  if (!user) {
    return {
      canSend: false,
      remaining: 0,
      limit: 0,
      error: "User not found",
      errorCode: USAGE_ERROR_CODES.USER_NOT_FOUND,
    }
  }

  const now = Date.now()
  const limit = user.anonymous
    ? NON_AUTH_DAILY_MESSAGE_LIMIT
    : AUTH_DAILY_MESSAGE_LIMIT
  const lastReset = user.dailyReset ?? 0
  const isNewDay = lastReset < startOfDayMs
  const count = isNewDay ? 0 : (user.dailyMessageCount ?? 0)
  if (count >= limit) {
    return {
      canSend: false,
      remaining: 0,
      limit,
      count,
      isAnonymous: user.anonymous,
    }
  }

  const nextCount = count + 1

  await ctx.db.patch(user._id, {
    messageCount: (user.messageCount ?? 0) + 1,
    dailyMessageCount: nextCount,
    dailyReset: isNewDay ? startOfDayMs : user.dailyReset,
    lastActiveAt: now,
  })

  return {
    canSend: true,
    remaining: limit - nextCount,
    limit,
    count: nextCount,
    isAnonymous: user.anonymous,
  }
}

export const admit = optionalAuthMutation({
  args: {
    anonymousId: v.optional(v.string()),
  },
  handler: admitUsageHandler,
})
