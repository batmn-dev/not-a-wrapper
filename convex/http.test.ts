import { afterAll, afterEach, describe, expect, it, vi } from "vitest"
import type { Id } from "./_generated/dataModel"
import { handleProfileImageUploadRequest } from "./http"

vi.mock("./workosAuth", () => ({
  authKit: { registerRoutes: vi.fn() },
}))

const storageId = "storage-profile-image" as Id<"_storage">
const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

function createUploadHarness() {
  const getUserIdentity = vi.fn().mockResolvedValue({
    issuer: "https://auth.test",
    subject: "workos-user-1",
    tokenIdentifier: "https://auth.test|workos-user-1",
  })
  const runMutation = vi
    .fn()
    .mockResolvedValueOnce({ allowed: true, retryAfterMs: 0 })
    .mockResolvedValueOnce("https://images.test/avatar.png")
  const store = vi.fn().mockResolvedValue(storageId)
  const deleteStoredFile = vi.fn()

  return {
    ctx: {
      auth: { getUserIdentity },
      runMutation,
      storage: { delete: deleteStoredFile, store },
    } as unknown as Parameters<typeof handleProfileImageUploadRequest>[0],
    deleteStoredFile,
    getUserIdentity,
    runMutation,
    store,
  }
}

function imageRequest(
  body: Blob = new Blob(["image"], { type: "image/png" }),
  headers: HeadersInit = {}
) {
  return new Request("https://convex.test/profile-image", {
    method: "POST",
    headers: { "Content-Type": body.type, ...headers },
    body,
  })
}

describe("profile image HTTP upload", () => {
  afterEach(() => {
    consoleWarnSpy.mockClear()
  })

  afterAll(() => {
    consoleWarnSpy.mockRestore()
  })

  it("rejects unauthenticated uploads before consuming quota or storing data", async () => {
    const harness = createUploadHarness()
    harness.getUserIdentity.mockRejectedValue(new Error("Invalid token"))

    const response = await handleProfileImageUploadRequest(
      harness.ctx,
      imageRequest()
    )

    expect(response.status).toBe(401)
    expect(harness.runMutation).not.toHaveBeenCalled()
    expect(harness.store).not.toHaveBeenCalled()
  })

  it("rejects unsupported files before consuming quota or storing data", async () => {
    const harness = createUploadHarness()

    const response = await handleProfileImageUploadRequest(
      harness.ctx,
      imageRequest(new Blob(["file"], { type: "application/pdf" }))
    )

    expect(response.status).toBe(415)
    expect(harness.runMutation).not.toHaveBeenCalled()
    expect(harness.store).not.toHaveBeenCalled()
  })

  it("enforces the authenticated upload rate limit before storing data", async () => {
    const harness = createUploadHarness()
    harness.runMutation.mockReset().mockResolvedValue({
      allowed: false,
      retryAfterMs: 1_500,
    })

    const response = await handleProfileImageUploadRequest(
      harness.ctx,
      imageRequest()
    )

    expect(response.status).toBe(429)
    expect(response.headers.get("Retry-After")).toBe("2")
    expect(harness.runMutation.mock.calls[0]?.[1]).toEqual({
      bucket: "profile_image_upload",
    })
    expect(harness.store).not.toHaveBeenCalled()
  })

  it("stores the request body itself and commits only that new storage id", async () => {
    const harness = createUploadHarness()

    const response = await handleProfileImageUploadRequest(
      harness.ctx,
      imageRequest()
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      profileImageUrl: "https://images.test/avatar.png",
    })
    expect(harness.store).toHaveBeenCalledWith(expect.any(Blob))
    expect(harness.runMutation.mock.calls[1]?.[1]).toEqual({
      workosUserId: "workos-user-1",
      storageId,
      fileType: "image/png",
    })
    expect(harness.deleteStoredFile).not.toHaveBeenCalled()
  })

  it("deletes the newly stored file when the owner-bound commit fails", async () => {
    const harness = createUploadHarness()
    harness.runMutation
      .mockReset()
      .mockResolvedValueOnce({ allowed: true, retryAfterMs: 0 })
      .mockRejectedValueOnce(new Error("Commit failed"))

    const response = await handleProfileImageUploadRequest(
      harness.ctx,
      imageRequest()
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: "Profile image upload failed",
    })
    expect(harness.deleteStoredFile).toHaveBeenCalledWith(storageId)
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      JSON.stringify({ _tag: "profile_image_upload_failed" })
    )
  })
})
