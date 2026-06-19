import { v } from "convex/values"
import { mutation, internalQuery } from "./_generated/server"

/**
 * Submit feedback from authenticated user
 */
export const submit = mutation({
  args: {
    message: v.string(),
  },
  handler: async (ctx, { message }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Must be authenticated to submit feedback")
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
      .unique()

    if (!user) {
      throw new Error("User not found")
    }

    return await ctx.db.insert("feedback", {
      userId: user._id,
      message,
    })
  },
})

/**
 * Get all feedback for admin purposes (internal query)
 * Only callable from other Convex functions, not from clients
 */
export const list = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("feedback").order("desc").collect()
  },
})
