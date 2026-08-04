import { describe, expect, it, vi } from "vitest"
import type { Doc, Id } from "./_generated/dataModel"
import { isProfileImageMetadataValid, saveProfileImageHandler } from "./users"

const userId = "user-1" as Id<"users">
const storageId = "storage-new" as Id<"_storage">
const previousStorageId = "storage-old" as Id<"_storage">

describe("profile image validation", () => {
  it("accepts supported images with matching stored metadata", () => {
    expect(
      isProfileImageMetadataValid(
        { size: 42, contentType: "image/png" },
        "image/png"
      )
    ).toBe(true)
    expect(
      isProfileImageMetadataValid(
        { size: 42, contentType: "application/pdf" },
        "application/pdf"
      )
    ).toBe(false)
    expect(
      isProfileImageMetadataValid(
        { size: 42, contentType: "image/png" },
        "image/jpeg"
      )
    ).toBe(false)
    expect(
      isProfileImageMetadataValid(
        { size: 11 * 1024 * 1024, contentType: "image/png" },
        "image/png"
      )
    ).toBe(false)
  })

  it("persists the validated image and removes only the previous owned image", async () => {
    const patch = vi.fn()
    const deleteStoredFile = vi.fn()
    const user = {
      _id: userId,
      _creationTime: 1,
      workosUserId: "workos-user-1",
      email: "user@example.com",
      profileImageStorageId: previousStorageId,
    } as Doc<"users">
    const ctx = {
      user,
      db: {
        patch,
        system: {
          get: vi.fn().mockResolvedValue({
            size: 42,
            contentType: "image/png",
          }),
        },
      },
      storage: {
        delete: deleteStoredFile,
        getUrl: vi.fn().mockResolvedValue("https://images.test/avatar.png"),
      },
    } as unknown as Parameters<typeof saveProfileImageHandler>[0]

    await expect(
      saveProfileImageHandler(ctx, { storageId, fileType: "image/png" })
    ).resolves.toBe("https://images.test/avatar.png")
    expect(patch).toHaveBeenCalledWith(userId, {
      profileImageOverride: "https://images.test/avatar.png",
      profileImageStorageId: storageId,
    })
    expect(deleteStoredFile).toHaveBeenCalledWith(previousStorageId)
  })

  it("does not persist or delete caller-supplied invalid storage", async () => {
    const patch = vi.fn()
    const deleteStoredFile = vi.fn()
    const ctx = {
      user: {
        _id: userId,
        profileImageStorageId: previousStorageId,
      },
      db: {
        patch,
        system: {
          get: vi.fn().mockResolvedValue({
            size: 42,
            contentType: "application/pdf",
          }),
        },
      },
      storage: { delete: deleteStoredFile, getUrl: vi.fn() },
    } as unknown as Parameters<typeof saveProfileImageHandler>[0]

    await expect(
      saveProfileImageHandler(ctx, {
        storageId,
        fileType: "application/pdf",
      })
    ).rejects.toThrow("Profile image failed server validation")
    expect(patch).not.toHaveBeenCalled()
    expect(deleteStoredFile).not.toHaveBeenCalled()
  })
})
