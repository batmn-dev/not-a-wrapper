import { v } from "convex/values"
import {
  isAllowedFileMimeType,
  MAX_FILE_SIZE,
  normalizeFileMimeType,
} from "../lib/file/policy"
import { internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import {
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import {
  authenticatedMutation,
  authenticatedQuery,
  maybeAuthQuery,
  ownedChatMutation,
  ownedChatQuery,
} from "./lib/authedFunctions"

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
  chatId?: Id<"chats">
  userId: Id<"users">
  storageId?: Id<"_storage">
  fileUrl: string
  fileName?: string
  fileType?: string
  fileSize?: number
}

const STAGED_ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000

export function isStoredFileMetadataValid(
  metadata: { size: number; contentType?: string | null } | null,
  declaredType: string | undefined
): boolean {
  if (!metadata || metadata.size > MAX_FILE_SIZE) return false
  const storedType = normalizeFileMimeType(metadata.contentType)
  return (
    isAllowedFileMimeType(storedType) &&
    storedType === normalizeFileMimeType(declaredType)
  )
}

export function isFileUploadLimitExceeded(
  user: FileUploadLimitUser,
  todayCount: number
): boolean {
  if (user.premium === true) return false
  return todayCount >= DAILY_FILE_UPLOAD_LIMIT
}

export function getFileUploadLimit(user: FileUploadLimitUser): number | null {
  return user.premium === true
    ? PREMIUM_FILE_UPLOAD_LIMIT
    : DAILY_FILE_UPLOAD_LIMIT
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
  const startOfTomorrow = new Date(startOfDay)
  startOfTomorrow.setUTCDate(startOfDay.getUTCDate() + 1)

  const attachments = await ctx.db
    .query("chatAttachments")
    .withIndex("by_user", (q) =>
      q
        .eq("userId", userId)
        .gte("_creationTime", startOfDay.getTime())
        .lt("_creationTime", startOfTomorrow.getTime())
    )
    .collect()

  return attachments.length
}

/**
 * Generate an upload URL for file storage
 * Enforces daily upload limit server-side
 */
export const generateUploadUrl = authenticatedMutation({
  args: {},
  handler: async (ctx) => {
    const user = ctx.user
    // Enforce daily upload limit server-side. Premium users are unlimited, so
    // avoid scanning their daily attachments.
    if (getFileUploadLimit(user) !== null) {
      const todayCount = await getTodayUploadCount(ctx, user._id)

      if (isFileUploadLimitExceeded(user, todayCount)) {
        return null
      }
    }

    return await ctx.storage.generateUploadUrl()
  },
})

/**
 * Get the URL for a stored file the caller owns.
 *
 * Requires authentication and verifies the caller owns a chatAttachment backed
 * by this storage id before returning the URL — otherwise any authenticated (or
 * previously, any unauthenticated) caller could read any file by guessing a
 * storage id.
 */
export const getUrl = authenticatedQuery({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const owned = await ctx.db
      .query("chatAttachments")
      .withIndex("by_user", (q) => q.eq("userId", ctx.user._id))
      .filter((q) => q.eq(q.field("storageId"), storageId))
      .first()
    if (!owned) return null

    return await ctx.storage.getUrl(storageId)
  },
})

/** Save an uploaded file as a user-owned staged attachment. */
export const saveStagedAttachment = authenticatedMutation({
  args: {
    storageId: v.id("_storage"),
    fileName: v.optional(v.string()),
    fileType: v.optional(v.string()),
    fileSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = ctx.user

    const metadata = await ctx.db.system.get("_storage", args.storageId)
    const storedType = normalizeFileMimeType(metadata?.contentType)
    if (!metadata || !isStoredFileMetadataValid(metadata, args.fileType)) {
      if (metadata) await ctx.storage.delete(args.storageId)
      throw new Error("Stored file failed server validation")
    }

    // Re-check daily upload limit to prevent bypass via pre-fetched upload URLs.
    if (getFileUploadLimit(user) !== null) {
      const todayCount = await getTodayUploadCount(ctx, user._id)

      if (isFileUploadLimitExceeded(user, todayCount)) {
        // NOTE: We intentionally do NOT delete args.storageId here because we cannot
        // verify it belongs to this user. Deleting without ownership verification would
        // allow an attacker to delete other users' files by passing their storageId.
        // Orphaned files should be cleaned up by a scheduled background job.
        return null
      }
    }

    // Get the public URL
    const fileUrl = await ctx.storage.getUrl(args.storageId)
    if (!fileUrl) throw new Error("Failed to get file URL")

    const attachmentId = await ctx.db.insert("chatAttachments", {
      userId: user._id,
      storageId: args.storageId,
      fileUrl,
      fileName: args.fileName,
      fileType: storedType,
      fileSize: metadata.size,
      stagedAt: Date.now(),
    })

    await ctx.scheduler.runAfter(
      STAGED_ATTACHMENT_TTL_MS,
      internal.files.cleanupStagedAttachment,
      { attachmentId }
    )

    return attachmentId
  },
})

/**
 * Bind a complete staged set to one owned chat. Every row is validated before
 * any patch, so callers never receive or dispatch a partial subset.
 */
export const attachStagedFiles = ownedChatMutation({
  args: { attachmentIds: v.array(v.id("chatAttachments")) },
  handler: async (ctx, { attachmentIds }) => {
    const uniqueIds = new Set(attachmentIds)
    if (uniqueIds.size !== attachmentIds.length) {
      throw new Error("Duplicate attachment reference")
    }

    const attachments = await Promise.all(
      attachmentIds.map((attachmentId) => ctx.db.get(attachmentId))
    )
    for (const attachment of attachments) {
      if (!attachment || attachment.userId !== ctx.user._id) {
        throw new Error("Attachment not found")
      }
      if (attachment.chatId && attachment.chatId !== ctx.chat._id) {
        throw new Error("Attachment belongs to another chat")
      }
      if (!attachment.storageId) {
        throw new Error("Attachment is not ready")
      }
    }

    for (const attachment of attachments) {
      if (attachment?.chatId === ctx.chat._id) continue
      await ctx.db.patch(attachment!._id, {
        chatId: ctx.chat._id,
        stagedAt: undefined,
      })
    }

    return attachments.map((attachment) => ({
      name: attachment!.fileName ?? "File",
      contentType: attachment!.fileType ?? "application/octet-stream",
      url: attachment!.fileUrl,
      attachmentId: attachment!._id,
    }))
  },
})

/** Resolve an owner-verified preview source for the same-origin proxy. */
export const getAttachmentPreview = authenticatedQuery({
  args: { attachmentId: v.id("chatAttachments") },
  handler: async (ctx, { attachmentId }) => {
    const attachment = await ctx.db.get(attachmentId)
    if (!attachment || attachment.userId !== ctx.user._id) return null
    if (!attachment.storageId) return null
    const url = await ctx.storage.getUrl(attachment.storageId)
    if (!url) return null
    return {
      url,
      fileName: attachment.fileName ?? "File",
      fileType: attachment.fileType ?? "application/octet-stream",
      fileSize: attachment.fileSize,
    }
  },
})

/** Best-effort server cleanup for abandoned staged rows. */
export const cleanupStagedAttachment = internalMutation({
  args: { attachmentId: v.id("chatAttachments") },
  handler: async (ctx, { attachmentId }) => {
    const attachment = await ctx.db.get(attachmentId)
    if (!attachment?.stagedAt || attachment.chatId) return
    if (Date.now() - attachment.stagedAt < STAGED_ATTACHMENT_TTL_MS) return
    if (attachment.storageId) await ctx.storage.delete(attachment.storageId)
    await ctx.db.delete(attachmentId)
  },
})

export const getTrustedTextAttachmentsForChat = ownedChatQuery({
  args: {
    references: v.array(
      v.object({
        attachmentId: v.optional(v.string()),
        url: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, { references }) => {
    const chatId = ctx.chat._id
    const attachments = await ctx.db
      .query("chatAttachments")
      .withIndex("by_chat", (q) => q.eq("chatId", chatId))
      .collect()

    const trustedAttachments = selectTrustedTextAttachmentsForModelInput({
      attachments,
      references,
      chatId,
      userId: ctx.user._id,
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
export const checkUploadLimit = maybeAuthQuery({
  args: {},
  handler: async (ctx) => {
    const user = ctx.user
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
 * Delete a file. Ownership is a per-row check on the attachment, not a builder
 * resource, so this stays an authenticatedMutation with an inline owner check.
 */
export const deleteFile = authenticatedMutation({
  args: { attachmentId: v.id("chatAttachments") },
  handler: async (ctx, { attachmentId }) => {
    const attachment = await ctx.db.get(attachmentId)
    if (!attachment) throw new Error("Attachment not found")

    if (attachment.userId !== ctx.user._id) {
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
