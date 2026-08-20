import { v } from "convex/values"
import {
  authenticatedMutation,
  authenticatedQuery,
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
 * Key-settings metadata for the route resolver and the API-key settings UI:
 * provider id + routing preference per stored key. Absent preference means
 * "priority" (the historical BYOK-first behavior). Never exposes encrypted
 * or decrypted key material.
 */
export const getKeySettings = authenticatedQuery({
  args: {},
  handler: async (ctx) => {
    const keys = await ctx.db
      .query("userKeys")
      .withIndex("by_user", (q) => q.eq("userId", ctx.user._id))
      .collect()

    return keys.map((key) => ({
      provider: key.provider,
      preference: key.preference ?? ("priority" as const),
    }))
  },
})

/**
 * Update the routing preference for a stored key without re-entering the
 * secret. No-op error when no key is stored for the provider.
 */
export const setPreference = authenticatedMutation({
  args: {
    provider: v.string(),
    preference: v.union(v.literal("priority"), v.literal("fallback")),
  },
  handler: async (ctx, { provider, preference }) => {
    const keys = await ctx.db
      .query("userKeys")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", ctx.user._id).eq("provider", provider)
      )
      .collect()

    const key = keys[0]
    if (!key) {
      throw new Error("No stored key for this provider")
    }
    await ctx.db.patch(key._id, { preference })
  },
})

/**
 * Get API key for a specific provider.
 *
 * Includes `ownerId` (the caller's WorkOS subject) so the server can rebuild the
 * AAD binding needed to decrypt — the same identifier the encrypting route used.
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

    const key = keys[0]
    if (!key) return null

    return { ...key, ownerId: user.workosUserId }
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
