import { v } from "convex/values"
import { MAX_FILE_SIZE, normalizeFileMimeType } from "../lib/file/policy"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx } from "./_generated/server"
import {
  authenticatedMutation,
  identityMutation,
  identityQuery,
  maybeAuthMutation,
  maybeAuthQuery,
} from "./lib/authedFunctions"
import { upsertAppUserFromWorkOS } from "./userSync"

const PROFILE_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
])

export function isProfileImageMetadataValid(
  metadata: { size: number; contentType?: string | null } | null,
  declaredType: string
): boolean {
  if (!metadata || metadata.size > MAX_FILE_SIZE) return false

  const storedType = normalizeFileMimeType(metadata.contentType)
  return (
    PROFILE_IMAGE_MIME_TYPES.has(storedType) &&
    storedType === normalizeFileMimeType(declaredType)
  )
}

type SaveProfileImageCtx = MutationCtx & {
  user: Doc<"users">
}

export async function saveProfileImageHandler(
  ctx: SaveProfileImageCtx,
  { storageId, fileType }: { storageId: Id<"_storage">; fileType: string }
) {
  const metadata = await ctx.db.system.get("_storage", storageId)
  if (!isProfileImageMetadataValid(metadata, fileType)) {
    throw new Error("Profile image failed server validation")
  }

  const profileImageUrl = await ctx.storage.getUrl(storageId)
  if (!profileImageUrl) throw new Error("Failed to get profile image URL")

  const previousStorageId = ctx.user.profileImageStorageId
  await ctx.db.patch(ctx.user._id, {
    profileImageOverride: profileImageUrl,
    profileImageStorageId: storageId,
  })

  if (previousStorageId && previousStorageId !== storageId) {
    await ctx.storage.delete(previousStorageId)
  }

  return profileImageUrl
}

/**
 * Get the authenticated caller by WorkOS user ID. Self-identity-match: the
 * caller may only read their own record.
 */
export const getByWorkosUserId = identityQuery({
  args: { workosUserId: v.string() },
  handler: async (ctx, { workosUserId }) => {
    if (ctx.identity.subject !== workosUserId) {
      throw new Error("Cannot read a different user")
    }

    return await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", workosUserId))
      .unique()
  },
})

/**
 * Get current authenticated user
 */
export const getCurrent = maybeAuthQuery({
  args: {},
  handler: async (ctx) => ctx.user,
})

/**
 * Create or update user from the authenticated WorkOS session. Self-identity-
 * match on a bootstrap path: the user row may not exist yet, so this resolves
 * the identity rather than an existing user.
 */
export const createOrUpdate = identityMutation({
  args: {
    workosUserId: v.string(),
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    displayName: v.optional(v.string()),
    profileImage: v.optional(v.string()),
    workosUpdatedAt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (ctx.identity.subject !== args.workosUserId) {
      throw new Error("Cannot sync a different user")
    }

    return await upsertAppUserFromWorkOS(ctx, {
      workosUserId: args.workosUserId,
      email: args.email,
      firstName: args.firstName,
      lastName: args.lastName,
      displayName: args.displayName,
      profileImage: args.profileImage,
      workosUpdatedAt: args.workosUpdatedAt,
      markActive: true,
    })
  },
})

/**
 * Update user's last active timestamp
 */
export const updateLastActive = maybeAuthMutation({
  args: {},
  handler: async (ctx) => {
    if (ctx.user) {
      await ctx.db.patch(ctx.user._id, { lastActiveAt: Date.now() })
    }
  },
})

/**
 * Update user's favorite models
 */
export const updateFavoriteModels = authenticatedMutation({
  args: {
    favoriteModels: v.array(v.string()),
  },
  handler: async (ctx, { favoriteModels }) => {
    await ctx.db.patch(ctx.user._id, { favoriteModels })
    return favoriteModels
  },
})

/**
 * Update user profile fields
 * Supports updating: systemPrompt, displayName
 */
export const updateProfile = authenticatedMutation({
  args: {
    systemPrompt: v.optional(v.string()),
    displayName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Build update object with only provided fields
    const updates: Record<string, string | undefined> = {}
    if (args.systemPrompt !== undefined) {
      updates.systemPrompt = args.systemPrompt
    }
    if (args.displayName !== undefined) {
      updates.displayName = args.displayName
    }

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(ctx.user._id, updates)
    }

    return { success: true }
  },
})

/** Generate a one-time upload URL for the authenticated user's profile image. */
export const generateProfileImageUploadUrl = authenticatedMutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
})

/** Validate and persist a newly uploaded profile image for the current user. */
export const saveProfileImage = authenticatedMutation({
  args: {
    storageId: v.id("_storage"),
    fileType: v.string(),
  },
  handler: saveProfileImageHandler,
})
