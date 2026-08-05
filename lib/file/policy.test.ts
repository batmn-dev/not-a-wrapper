import { describe, expect, it } from "vitest"
import { sniffProfileImageMimeType } from "./policy"

function bytes(...values: (number | string)[]) {
  return new Uint8Array(
    values.flatMap((value) =>
      typeof value === "string"
        ? [...value].map((char) => char.charCodeAt(0))
        : [value]
    )
  )
}

describe("sniffProfileImageMimeType", () => {
  it("recognizes each allowed profile-image signature", () => {
    expect(
      sniffProfileImageMimeType(bytes(0xff, 0xd8, 0xff, 0xe0))
    ).toBe("image/jpeg")
    expect(
      sniffProfileImageMimeType(
        bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0)
      )
    ).toBe("image/png")
    expect(sniffProfileImageMimeType(bytes("GIF89a"))).toBe("image/gif")
    expect(sniffProfileImageMimeType(bytes("GIF87a"))).toBe("image/gif")
    expect(
      sniffProfileImageMimeType(bytes("RIFF", 0, 0, 0, 0, "WEBP"))
    ).toBe("image/webp")
  })

  it("returns null for unknown, truncated, or lookalike headers", () => {
    expect(sniffProfileImageMimeType(bytes("not an image"))).toBeNull()
    expect(sniffProfileImageMimeType(new Uint8Array(0))).toBeNull()
    expect(sniffProfileImageMimeType(bytes(0x89, "PN"))).toBeNull()
    expect(sniffProfileImageMimeType(bytes("GIF88a"))).toBeNull()
    expect(
      sniffProfileImageMimeType(bytes("RIFF", 0, 0, 0, 0, "WAVE"))
    ).toBeNull()
  })
})
