import { describe, expect, it, vi } from "vitest"
import type { Doc, Id } from "./_generated/dataModel"
import {
  assertAttachmentCanBeDeletedIndependently,
  getAttachmentPreviewForUserHandler,
  getFileUrlForUserHandler,
  getFileUploadLimit,
  getFileUploadLimitStatus,
  isFileUploadLimitExceeded,
  isStoredFileMetadataValid,
  saveStagedAttachmentHandler,
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
      user: { _id: userId },
      db: {
        system: {
          get: vi.fn().mockResolvedValue({
            size: 42,
            contentType: "application/pdf",
          }),
        },
      },
      storage: { delete: deleteStoredFile },
    } as unknown as Parameters<typeof saveStagedAttachmentHandler>[0]

    await expect(
      saveStagedAttachmentHandler(ctx, {
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

describe("attachment reads", () => {
  it("denies URLs and previews when the bound Chat's Project is tombstoned", async () => {
    const user: Doc<"users"> = {
      _id: userId,
      _creationTime: 1,
      workosUserId: "workos-user-1",
      email: "user@example.com",
    }
    const project: Doc<"projects"> = {
      _id: "project-1" as Id<"projects">,
      _creationTime: 1,
      userId,
      name: "Deleting",
      deletingAt: 2,
    }
    const chat: Doc<"chats"> = {
      _id: chatId,
      _creationTime: 1,
      userId,
      projectId: project._id,
      public: false,
      pinned: false,
      updatedAt: 1,
    }
    const bound: Doc<"chatAttachments"> = {
      ...attachment(),
      _creationTime: 1,
    }
    const getUrl = vi.fn().mockResolvedValue("https://convex.cloud/file")
    const resultApi = {
      filter: () => resultApi,
      first: async () => bound,
    }
    const ctx = {
      user,
      db: {
        get: async (id: string) => {
          if (id === bound._id) return bound
          if (id === chat._id) return chat
          if (id === project._id) return project
          return null
        },
        query: () => ({
          withIndex: () => resultApi,
        }),
      },
      storage: { getUrl },
    } as unknown as Parameters<typeof getFileUrlForUserHandler>[0]

    await expect(
      getFileUrlForUserHandler(ctx, { storageId })
    ).resolves.toBeNull()
    await expect(
      getAttachmentPreviewForUserHandler(ctx, { attachmentId })
    ).resolves.toBeNull()
    expect(getUrl).not.toHaveBeenCalled()
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
