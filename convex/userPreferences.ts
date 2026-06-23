import { v } from "convex/values"
import {
  authenticatedMutation,
  maybeAuthQuery,
} from "./lib/authedFunctions"

/**
 * Get preferences for current user
 */
export const get = maybeAuthQuery({
  args: {},
  handler: async (ctx) => {
    const user = ctx.user
    if (!user) return null

    return await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique()
  },
})

/**
 * Update preferences
 */
export const update = authenticatedMutation({
  args: {
    layout: v.optional(v.string()),
    promptSuggestions: v.optional(v.boolean()),
    showToolInvocations: v.optional(v.boolean()),
    showConversationPreviews: v.optional(v.boolean()),
    webSearchEnabled: v.optional(v.boolean()),
    hiddenModels: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", ctx.user._id))
      .unique()

    if (existing) {
      await ctx.db.patch(existing._id, args)
      return existing._id
    }

    return await ctx.db.insert("userPreferences", {
      userId: ctx.user._id,
      ...args,
    })
  },
})
