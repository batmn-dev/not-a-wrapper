import sharp from "sharp"
import { describe, expect, it } from "vitest"
import { isDecodableProfileImage } from "./profileImageValidation"

const FORMAT_CASES = [
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
] as const

async function onePixelImage(format: (typeof FORMAT_CASES)[number][0]) {
  return await sharp({
    create: {
      width: 1,
      height: 1,
      channels: 4,
      background: { r: 12, g: 34, b: 56, alpha: 1 },
    },
  })
    .toFormat(format)
    .toBuffer()
}

describe("profile image decoding", () => {
  it.each(FORMAT_CASES)(
    "accepts a valid %s image",
    async (format, mimeType) => {
      const image = await onePixelImage(format)

      await expect(isDecodableProfileImage(image, mimeType)).resolves.toBe(true)
    }
  )

  it.each([
    ["JPEG", "image/jpeg", [0xff, 0xd8, 0xff, ...Buffer.from("not an image")]],
    [
      "PNG",
      "image/png",
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.from("fake")],
    ],
    ["GIF", "image/gif", [...Buffer.from("GIF89a"), ...Buffer.from("fake")]],
    [
      "WebP",
      "image/webp",
      [...Buffer.from("RIFF"), 4, 0, 0, 0, ...Buffer.from("WEBPfake")],
    ],
  ])("rejects a signature-only %s payload", async (_name, mimeType, bytes) => {
    await expect(
      isDecodableProfileImage(new Uint8Array(bytes), mimeType)
    ).resolves.toBe(false)
  })

  it("rejects a truncated image that still has a valid signature", async () => {
    const image = await onePixelImage("jpeg")

    await expect(
      isDecodableProfileImage(image.subarray(0, 24), "image/jpeg")
    ).resolves.toBe(false)
  })

  it("rejects a valid image whose decoded format differs from its declared type", async () => {
    const image = await onePixelImage("jpeg")

    await expect(isDecodableProfileImage(image, "image/png")).resolves.toBe(
      false
    )
  })
})
