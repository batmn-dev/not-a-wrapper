import { describe, expect, it, vi } from "vitest"
import type { Id } from "./_generated/dataModel"
import {
  assertAttachmentCanBeDeletedIndependently,
  getFileUploadLimit,
  getFileUploadLimitStatus,
  isFileUploadLimitExceeded,
  isStoredFileMetadataValid,
  saveStagedAttachment,
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

describe("stored file validation", () => {
  it("accepts only allowed matching server metadata within the size limit", () => {
    expect(
      isStoredFileMetadataValid(
        { size: 42, contentType: "application/pdf" },
        "application/pdf"
      )
    ).toBe(true)
    expect(
      isStoredFileMetadataValid(
        { size: 42, contentType: "application/pdf" },
        "image/png"
      )
    ).toBe(false)
    expect(
      isStoredFileMetadataValid(
        { size: 11 * 1024 * 1024, contentType: "application/pdf" },
        "application/pdf"
      )
    ).toBe(false)
    expect(
      isStoredFileMetadataValid(
        { size: 42, contentType: "application/octet-stream" },
        "application/octet-stream"
      )
    ).toBe(false)
  })

  it("does not delete caller-supplied storage on validation failure", async () => {
    const deleteStoredFile = vi.fn()
    const ctx = {
      auth: {
        getUserIdentity: vi.fn().mockResolvedValue({ subject: "workos-1" }),
      },
      db: {
        query: vi.fn().mockReturnValue({
          withIndex: vi.fn().mockReturnValue({
            unique: vi.fn().mockResolvedValue({ _id: userId }),
          }),
        }),
        system: {
          get: vi.fn().mockResolvedValue({
            size: 42,
            contentType: "application/pdf",
          }),
        },
      },
      storage: { delete: deleteStoredFile },
    } as unknown as Parameters<typeof saveStagedAttachment._handler>[0]

    await expect(
      saveStagedAttachment._handler(ctx, {
        storageId,
        fileType: "image/png",
      })
    ).rejects.toThrow("Stored file failed server validation")
    expect(deleteStoredFile).not.toHaveBeenCalled()
  })
})

describe("attachment deletion", () => {
  it("allows staged cleanup but rejects deletion after chat binding", () => {
    expect(() => assertAttachmentCanBeDeletedIndependently({})).not.toThrow()
    expect(() =>
      assertAttachmentCanBeDeletedIndependently({ chatId })
    ).toThrow("Attached files cannot be deleted independently")
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
