import { v } from "convex/values"
import { mutation, query } from "./_generated/server"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import type { Id } from "./_generated/dataModel"

const DAILY_FILE_UPLOAD_LIMIT = 5
const PREMIUM_FILE_UPLOAD_LIMIT = null

type FileUploadLimitUser = {
  premium?: boolean
}

type TrustedTextAttachmentForModelInput = {
  attachmentId: Id<"chatAttachments">
  url: string
  filename?: string
  mediaType?: string
  size?: number
}

type TrustedTextAttachmentReference = {
  attachmentId?: string
  url?: string
}

type TrustedTextAttachmentCandidate = {
  _id: Id<"chatAttachments">
  chatId: Id<"chats">
  userId: Id<"users">
  storageId?: Id<"_storage">
  fileUrl: string
  fileName?: string
  fileType?: string
  fileSize?: number
}

export function isFileUploadLimitExceeded(
  user: FileUploadLimitUser,
  todayCount: number
): boolean {
  if (user.premium === true) return false
  return todayCount >= DAILY_FILE_UPLOAD_LIMIT
}

export function getFileUploadLimit(user: FileUploadLimitUser): number | null {
  return user.premium === true ? PREMIUM_FILE_UPLOAD_LIMIT : DAILY_FILE_UPLOAD_LIMIT
}

export function getFileUploadLimitStatus(
  user: FileUploadLimitUser,
  todayCount: number | null
): { count: number | null; limit: number | null; canUpload: boolean } {
  const limit = getFileUploadLimit(user)
  if (limit === null) {
    return { count: null, limit: null, canUpload: true }
  }

  const count = todayCount ?? 0
  return {
    count,
    limit,
    canUpload: !isFileUploadLimitExceeded(user, count),
  }
}

function normalizeMediaType(mediaType: string | undefined): string {
  return mediaType?.split(";")[0]?.trim().toLowerCase() ?? ""
}

export function selectTrustedTextAttachmentsForModelInput(args: {
  attachments: readonly TrustedTextAttachmentCandidate[]
  references: readonly TrustedTextAttachmentReference[]
  chatId: Id<"chats">
  userId: Id<"users">
}): TrustedTextAttachmentCandidate[] {
  const requestedAttachmentIds = new Set(
    args.references
      .map((reference) => reference.attachmentId)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  )
  const requestedUrls = new Set(
    args.references
      .map((reference) => reference.url)
      .filter((url): url is string => typeof url === "string" && url.length > 0)
  )

  if (requestedAttachmentIds.size === 0 && requestedUrls.size === 0) {
    return []
  }

  return args.attachments.filter((attachment) => {
    if (attachment.chatId !== args.chatId) return false
    if (attachment.userId !== args.userId) return false
    if (!attachment.storageId) return false
    if (normalizeMediaType(attachment.fileType) !== "text/plain") return false
    return (
      requestedAttachmentIds.has(attachment._id) ||
      requestedUrls.has(attachment.fileUrl)
    )
  })
}

async function getTodayUploadCount(
  ctx: MutationCtx | QueryCtx,
  userId: Id<"users">
): Promise<number> {
  const startOfDay = new Date()
  startOfDay.setUTCHours(0, 0, 0, 0)

  const attachments = await ctx.db
    .query("chatAttachments")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect()

  return attachments.filter((a) => a._creationTime >= startOfDay.getTime())
    .length
}

/**
 * Generate an upload URL for file storage
 * Enforces daily upload limit server-side
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    // Get user from database
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
      .unique()

    if (!user) throw new Error("User not found")

    // Enforce daily upload limit server-side. Premium users are unlimited, so
    // avoid scanning their daily attachments.
    if (getFileUploadLimit(user) !== null) {
      const todayCount = await getTodayUploadCount(ctx, user._id)

      if (isFileUploadLimitExceeded(user, todayCount)) {
        throw new Error(
          `Daily file upload limit reached (${DAILY_FILE_UPLOAD_LIMIT} files per day)`
        )
      }
    }

    return await ctx.storage.generateUploadUrl()
  },
})

/**
 * Get a public URL for a stored file
 */
export const getUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    return await ctx.storage.getUrl(storageId)
  },
})

/**
 * Save file metadata after upload
 */
export const saveAttachment = mutation({
  args: {
    chatId: v.id("chats"),
    storageId: v.id("_storage"),
    fileName: v.optional(v.string()),
    fileType: v.optional(v.string()),
    fileSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
      .unique()

    if (!user) throw new Error("User not found")

    // Verify chat ownership before attaching file
    const chat = await ctx.db.get(args.chatId)
    if (!chat) throw new Error("Chat not found")
    if (chat.userId !== user._id) {
      throw new Error("Not authorized to attach files to this chat")
    }

    // Re-check daily upload limit to prevent bypass via pre-fetched upload URLs.
    if (getFileUploadLimit(user) !== null) {
      const todayCount = await getTodayUploadCount(ctx, user._id)

      if (isFileUploadLimitExceeded(user, todayCount)) {
        // NOTE: We intentionally do NOT delete args.storageId here because we cannot
        // verify it belongs to this user. Deleting without ownership verification would
        // allow an attacker to delete other users' files by passing their storageId.
        // Orphaned files should be cleaned up by a scheduled background job.
        throw new Error(
          `Daily file upload limit reached (${DAILY_FILE_UPLOAD_LIMIT} files per day)`
        )
      }
    }

    // Get the public URL
    const fileUrl = await ctx.storage.getUrl(args.storageId)
    if (!fileUrl) throw new Error("Failed to get file URL")

    return await ctx.db.insert("chatAttachments", {
      chatId: args.chatId,
      userId: user._id,
      storageId: args.storageId,
      fileUrl,
      fileName: args.fileName,
      fileType: args.fileType,
      fileSize: args.fileSize,
    })
  },
})

export const getTrustedTextAttachmentsForChat = query({
  args: {
    chatId: v.id("chats"),
    references: v.array(
      v.object({
        attachmentId: v.optional(v.string()),
        url: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, { chatId, references }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) =>
        q.eq("workosUserId", identity.subject)
      )
      .unique()

    if (!user) throw new Error("User not found")

    const chat = await ctx.db.get(chatId)
    if (!chat || chat.userId !== user._id) {
      throw new Error("Not authorized")
    }

    const attachments = await ctx.db
      .query("chatAttachments")
      .withIndex("by_chat", (q) => q.eq("chatId", chatId))
      .collect()

    const trustedAttachments = selectTrustedTextAttachmentsForModelInput({
      attachments,
      references,
      chatId,
      userId: user._id,
    })

    const result: TrustedTextAttachmentForModelInput[] = []
    for (const attachment of trustedAttachments) {
      if (!attachment.storageId) continue
      const url = await ctx.storage.getUrl(attachment.storageId)
      if (!url) continue

      result.push({
        attachmentId: attachment._id,
        url,
        filename: attachment.fileName,
        mediaType: attachment.fileType,
        size: attachment.fileSize,
      })
    }

    return result
  },
})

/**
 * Check daily file upload limit
 */
export const checkUploadLimit = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      return { count: 0, limit: DAILY_FILE_UPLOAD_LIMIT, canUpload: true }
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
      .unique()

    if (!user) {
      return { count: 0, limit: DAILY_FILE_UPLOAD_LIMIT, canUpload: true }
    }

    if (getFileUploadLimit(user) === null) {
      return getFileUploadLimitStatus(user, null)
    }

    const todayCount = await getTodayUploadCount(ctx, user._id)
    return getFileUploadLimitStatus(user, todayCount)
  },
})

/**
 * Delete a file
 */
export const deleteFile = mutation({
  args: { attachmentId: v.id("chatAttachments") },
  handler: async (ctx, { attachmentId }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const attachment = await ctx.db.get(attachmentId)
    if (!attachment) throw new Error("Attachment not found")

    // Verify ownership
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
      .unique()

    if (!user || attachment.userId !== user._id) {
      throw new Error("Not authorized")
    }

    // Delete from storage
    if (attachment.storageId) {
      await ctx.storage.delete(attachment.storageId)
    }

    // Delete metadata
    await ctx.db.delete(attachmentId)
  },
})
