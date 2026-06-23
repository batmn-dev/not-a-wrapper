import { v } from "convex/values"
import {
  authenticatedMutation,
  maybeAuthQuery,
} from "./lib/authedFunctions"

/**
 * Get all API keys for current user (encrypted)
 * NOTE: Use getProviderStatus instead when you only need to check which providers have keys
 */
export const getAll = maybeAuthQuery({
  args: {},
  handler: async (ctx) => {
    const user = ctx.user
    if (!user) return []

    return await ctx.db
      .query("userKeys")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()
  },
})

/**
 * Get provider status (which providers have API keys configured)
 * Returns only provider identifiers - does NOT expose encrypted key material
 * Use this for client-side presence checks instead of getAll
 */
export const getProviderStatus = maybeAuthQuery({
  args: {},
  handler: async (ctx) => {
    const user = ctx.user
    if (!user) return []

    const keys = await ctx.db
      .query("userKeys")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()

    // Return only provider identifiers, not encrypted key material
    return keys.map((key) => key.provider)
  },
})

/**
 * Get API key for a specific provider
 */
export const getByProvider = maybeAuthQuery({
  args: { provider: v.string() },
  handler: async (ctx, { provider }) => {
    const user = ctx.user
    if (!user) return null

    const keys = await ctx.db
      .query("userKeys")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", user._id).eq("provider", provider)
      )
      .collect()

    return keys[0] ?? null
  },
})

/**
 * Upsert API key (encrypted key stored)
 */
export const upsert = authenticatedMutation({
  args: {
    provider: v.string(),
    encryptedKey: v.string(),
    iv: v.string(),
  },
  handler: async (ctx, args) => {
    // Check for existing key
    const existing = await ctx.db
      .query("userKeys")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", ctx.user._id).eq("provider", args.provider)
      )
      .collect()

    if (existing[0]) {
      await ctx.db.patch(existing[0]._id, {
        encryptedKey: args.encryptedKey,
        iv: args.iv,
      })
      return existing[0]._id
    }

    return await ctx.db.insert("userKeys", {
      userId: ctx.user._id,
      provider: args.provider,
      encryptedKey: args.encryptedKey,
      iv: args.iv,
    })
  },
})

/**
 * Delete API key for a provider
 */
export const remove = authenticatedMutation({
  args: { provider: v.string() },
  handler: async (ctx, { provider }) => {
    const keys = await ctx.db
      .query("userKeys")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", ctx.user._id).eq("provider", provider)
      )
      .collect()

    if (keys[0]) {
      await ctx.db.delete(keys[0]._id)
    }
  },
})
