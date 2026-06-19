import { describe, expect, it } from "vitest"
import type { Id } from "./_generated/dataModel"
import {
  getFileUploadLimit,
  getFileUploadLimitStatus,
  isFileUploadLimitExceeded,
  selectTrustedTextAttachmentsForModelInput,
} from "./files"

const userId = "user-1" as Id<"users">
const otherUserId = "user-2" as Id<"users">
const chatId = "chat-1" as Id<"chats">
const otherChatId = "chat-2" as Id<"chats">
const storageId = "storage-1" as Id<"_storage">
const attachmentId = "attachment-1" as Id<"chatAttachments">
type TrustedAttachmentCandidate = Parameters<
  typeof selectTrustedTextAttachmentsForModelInput
>[0]["attachments"][number]

function attachment(
  overrides: Partial<TrustedAttachmentCandidate> = {}
): TrustedAttachmentCandidate {
  return {
    _id: attachmentId,
    chatId,
    userId,
    storageId,
    fileUrl: "https://convex.cloud/storage/notes.txt",
    fileName: "notes.txt",
    fileType: "text/plain; charset=utf-8",
    fileSize: 42,
    ...overrides,
  }
}

describe("file upload limits", () => {
  it("enforces the daily upload limit for non-premium users", () => {
    expect(isFileUploadLimitExceeded({ premium: false }, 5)).toBe(true)
    expect(isFileUploadLimitExceeded({}, 5)).toBe(true)
    expect(isFileUploadLimitExceeded({ premium: false }, 4)).toBe(false)
  })

  it("exempts premium users from the daily upload limit", () => {
    expect(isFileUploadLimitExceeded({ premium: true }, 5)).toBe(false)
    expect(isFileUploadLimitExceeded({ premium: true }, 50)).toBe(false)
  })

  it("reports an unlimited upload limit for premium users", () => {
    expect(getFileUploadLimit({ premium: false })).toBe(5)
    expect(getFileUploadLimit({ premium: true })).toBeNull()
  })

  it("reports a clear unlimited upload state without a daily count", () => {
    expect(getFileUploadLimitStatus({ premium: true }, null)).toEqual({
      count: null,
      limit: null,
      canUpload: true,
    })
  })

  it("reports counted upload state for non-premium users", () => {
    expect(getFileUploadLimitStatus({ premium: false }, 4)).toEqual({
      count: 4,
      limit: 5,
      canUpload: true,
    })
    expect(getFileUploadLimitStatus({ premium: false }, 5)).toEqual({
      count: 5,
      limit: 5,
      canUpload: false,
    })
  })
})

describe("trusted text attachments for model input", () => {
  it("trusts only same-user same-chat Convex storage text/plain attachments", () => {
    const trusted = attachment()
    const selected = selectTrustedTextAttachmentsForModelInput({
      chatId,
      userId,
      references: [
        {
          attachmentId,
          url: "http://169.254.169.254/latest/meta-data",
        },
      ],
      attachments: [
        trusted,
        attachment({
          _id: "other-user-attachment" as Id<"chatAttachments">,
          userId: otherUserId,
        }),
        attachment({
          _id: "other-chat-attachment" as Id<"chatAttachments">,
          chatId: otherChatId,
        }),
        attachment({
          _id: "client-url-attachment" as Id<"chatAttachments">,
          storageId: undefined,
        }),
        attachment({
          _id: "image-attachment" as Id<"chatAttachments">,
          fileType: "image/png",
        }),
      ],
    })

    expect(selected).toEqual([trusted])
  })

  it("does not trust forged URL-only references", () => {
    expect(
      selectTrustedTextAttachmentsForModelInput({
        chatId,
        userId,
        references: [
          { url: "http://169.254.169.254/latest/meta-data" },
          { url: "http://127.0.0.1:3210/private" },
          { url: "data:text/plain,secrets" },
        ],
        attachments: [attachment()],
      })
    ).toEqual([])
  })

  it("allows stored URL matches but leaves final fetch URL resolution to storage", () => {
    const stored = attachment({
      fileUrl: "https://convex.cloud/storage/notes.txt",
    })

    expect(
      selectTrustedTextAttachmentsForModelInput({
        chatId,
        userId,
        references: [{ url: "https://convex.cloud/storage/notes.txt" }],
        attachments: [stored],
      })
    ).toEqual([stored])
  })
})
