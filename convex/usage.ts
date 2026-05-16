import { v } from "convex/values"
import { mutation, query } from "./_generated/server"

// Import limits - these should match lib/config.ts
const NON_AUTH_DAILY_MESSAGE_LIMIT = 5
const AUTH_DAILY_MESSAGE_LIMIT = 1000
const DAILY_LIMIT_PRO_MODELS = 500

/**
 * Get the start of the current UTC day as a timestamp
 */
function getStartOfDayMs(): number {
  const startOfDay = new Date()
  startOfDay.setUTCHours(0, 0, 0, 0)
  return startOfDay.getTime()
}

/**
 * Check if user has reached their daily limit
 *
 * For unauthenticated users, pass an anonymousId (generated client-side and
 * persisted in localStorage) to track their usage across requests.
 */
export const checkUsage = query({
  args: {
    isProModel: v.boolean(),
    anonymousId: v.optional(v.string()),
  },
  handler: async (ctx, { isProModel, anonymousId }) => {
    const identity = await ctx.auth.getUserIdentity()
    const startOfDayMs = getStartOfDayMs()

    // Handle unauthenticated users
    if (!identity) {
      // If no anonymousId provided, we can't track usage - deny by default for safety
      if (!anonymousId) {
        return {
          canSend: false,
          remaining: 0,
          limit: NON_AUTH_DAILY_MESSAGE_LIMIT,
          isAnonymous: true,
          error: "Anonymous ID required for usage tracking",
        }
      }

      // Look up anonymous usage record
      const anonUsage = await ctx.db
        .query("anonymousUsage")
        .withIndex("by_anonymous_id", (q) => q.eq("anonymousId", anonymousId))
        .unique()

      // No record yet = new anonymous user with full limit
      if (!anonUsage) {
        return {
          canSend: true,
          remaining: NON_AUTH_DAILY_MESSAGE_LIMIT,
          limit: NON_AUTH_DAILY_MESSAGE_LIMIT,
          count: 0,
          isAnonymous: true,
        }
      }

      // Check if it's a new day (reset the count)
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

    // Handle authenticated users
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
      .unique()

    if (!user) {
      return {
        canSend: false,
        remaining: 0,
        limit: 0,
        error: "User not found",
      }
    }

    if (isProModel) {
      const lastReset = user.dailyProReset ?? 0
      const isNewDay = lastReset < startOfDayMs
      const count = isNewDay ? 0 : (user.dailyProMessageCount ?? 0)
      const remaining = Math.max(0, DAILY_LIMIT_PRO_MODELS - count)

      return {
        canSend: count < DAILY_LIMIT_PRO_MODELS,
        remaining,
        limit: DAILY_LIMIT_PRO_MODELS,
        count,
        isProModel: true,
      }
    }

    // Regular model limits
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

/**
 * Increment usage counters
 *
 * For unauthenticated users, pass an anonymousId (generated client-side and
 * persisted in localStorage) to track their usage across requests.
 */
export const incrementUsage = mutation({
  args: {
    isProModel: v.boolean(),
    anonymousId: v.optional(v.string()),
  },
  handler: async (ctx, { isProModel, anonymousId }) => {
    const identity = await ctx.auth.getUserIdentity()
    const startOfDayMs = getStartOfDayMs()

    // Handle unauthenticated users
    if (!identity) {
      // If no anonymousId provided, we can't track usage
      if (!anonymousId) {
        throw new Error("Anonymous ID required for usage tracking")
      }

      // Look up or create anonymous usage record
      const anonUsage = await ctx.db
        .query("anonymousUsage")
        .withIndex("by_anonymous_id", (q) => q.eq("anonymousId", anonymousId))
        .unique()

      if (!anonUsage) {
        // Create new anonymous usage record
        await ctx.db.insert("anonymousUsage", {
          anonymousId,
          dailyMessageCount: 1,
          dailyReset: startOfDayMs,
        })
        return
      }

      // Update existing record
      const isNewDay = anonUsage.dailyReset < startOfDayMs
      await ctx.db.patch(anonUsage._id, {
        dailyMessageCount: isNewDay ? 1 : anonUsage.dailyMessageCount + 1,
        dailyReset: isNewDay ? startOfDayMs : anonUsage.dailyReset,
      })
      return
    }

    // Handle authenticated users
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
      .unique()

    if (!user) return

    const now = Date.now()

    if (isProModel) {
      const lastReset = user.dailyProReset ?? 0
      const isNewDay = lastReset < startOfDayMs

      await ctx.db.patch(user._id, {
        dailyProMessageCount: isNewDay
          ? 1
          : (user.dailyProMessageCount ?? 0) + 1,
        dailyProReset: isNewDay ? startOfDayMs : user.dailyProReset,
        lastActiveAt: now,
      })
    } else {
      const lastReset = user.dailyReset ?? 0
      const isNewDay = lastReset < startOfDayMs

      await ctx.db.patch(user._id, {
        messageCount: (user.messageCount ?? 0) + 1,
        dailyMessageCount: isNewDay ? 1 : (user.dailyMessageCount ?? 0) + 1,
        dailyReset: isNewDay ? startOfDayMs : user.dailyReset,
        lastActiveAt: now,
      })
    }
  },
})
