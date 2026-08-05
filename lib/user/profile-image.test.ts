import { fetchClient } from "@/lib/fetch"
import { describe, expect, it, vi } from "vitest"
import { ProfileImageUploadError, uploadProfileImage } from "./profile-image"

vi.mock("@/lib/fetch", () => ({
  fetchClient: vi.fn(),
}))

describe("uploadProfileImage", () => {
  it("posts the raw image and returns the owner-bound profile URL", async () => {
    vi.mocked(fetchClient).mockResolvedValue(
      Response.json({ profileImageUrl: "https://images.test/avatar.png" })
    )
    const file = new File(["image"], "avatar.png", { type: "image/png" })

    await expect(uploadProfileImage(file)).resolves.toBe(
      "https://images.test/avatar.png"
    )
    expect(fetchClient).toHaveBeenCalledWith("/api/profile-image", {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: file,
    })
  })

  it("rejects failed or malformed upload responses", async () => {
    const file = new File(["image"], "avatar.png", { type: "image/png" })
    vi.mocked(fetchClient).mockResolvedValueOnce(
      Response.json({ error: "failed" }, { status: 500 })
    )
    await expect(uploadProfileImage(file)).rejects.toThrow(
      "Profile image upload failed"
    )

    vi.mocked(fetchClient).mockResolvedValueOnce(Response.json({ ok: true }))
    await expect(uploadProfileImage(file)).rejects.toThrow(
      "Profile image upload response was invalid"
    )
  })

  it("maps known failure statuses to user-facing messages", async () => {
    const file = new File(["image"], "avatar.png", { type: "image/png" })
    const cases: Array<[number, string]> = [
      [413, "Choose an image under 10MB."],
      [415, "Choose a JPEG, PNG, GIF, or WebP image."],
      [429, "You're updating your picture too quickly. Try again in a minute."],
    ]

    for (const [status, message] of cases) {
      vi.mocked(fetchClient).mockResolvedValueOnce(
        Response.json({ error: "upstream detail" }, { status })
      )
      await expect(uploadProfileImage(file)).rejects.toThrow(
        new ProfileImageUploadError(message)
      )
    }
  })
})
