import { internalQuery } from "./_generated/server"
import { v } from "convex/values"
import { authenticatedMutation } from "./lib/authedFunctions"

/**
 * Submit feedback from authenticated user
 */
export const submit = authenticatedMutation({
  args: {
    message: v.string(),
  },
  handler: async (ctx, { message }) => {
    return await ctx.db.insert("feedback", {
      userId: ctx.user._id,
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
