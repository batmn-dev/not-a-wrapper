import { v } from "convex/values"
import { mutation, query } from "./_generated/server"

/**
 * Get preferences for current user
 */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return null

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
      .unique()

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
export const update = mutation({
  args: {
    layout: v.optional(v.string()),
    promptSuggestions: v.optional(v.boolean()),
    showToolInvocations: v.optional(v.boolean()),
    showConversationPreviews: v.optional(v.boolean()),
    multiModelEnabled: v.optional(v.boolean()),
    webSearchEnabled: v.optional(v.boolean()),
    hiddenModels: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
      .unique()

    if (!user) throw new Error("User not found")

    const existing = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique()

    if (existing) {
      await ctx.db.patch(existing._id, args)
      return existing._id
    }

    return await ctx.db.insert("userPreferences", {
      userId: user._id,
      ...args,
    })
  },
})
