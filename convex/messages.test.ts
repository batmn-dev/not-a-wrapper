import { describe, expect, it } from "vitest"
import { normalizeMessagePartsForStorage } from "./messages"

describe("normalizeMessagePartsForStorage", () => {
  it("defaults missing parts to an empty array", () => {
    expect(normalizeMessagePartsForStorage(undefined)).toEqual([])
  })

  it("bridges legacy attachments into file parts for storage", () => {
    expect(
      normalizeMessagePartsForStorage(
        [{ type: "text", text: "see attached" }],
        [
          {
            name: "receipt.pdf",
            contentType: "application/pdf",
            url: "https://example.com/receipt.pdf",
          },
        ]
      )
    ).toEqual([
      { type: "text", text: "see attached" },
      {
        type: "file",
        filename: "receipt.pdf",
        mediaType: "application/pdf",
        url: "https://example.com/receipt.pdf",
      },
    ])
  })

  it("keeps existing file parts canonical when legacy attachments are duplicated", () => {
    const filePart = {
      type: "file",
      filename: "photo.png",
      mediaType: "image/png",
      url: "https://example.com/photo.png",
    }

    expect(
      normalizeMessagePartsForStorage([filePart], [
        {
          name: "legacy-photo.png",
          contentType: "image/png",
          url: "https://example.com/legacy-photo.png",
        },
      ])
    ).toEqual([filePart])
  })

  it("ignores malformed legacy attachments", () => {
    expect(
      normalizeMessagePartsForStorage([], [
        null,
        { name: "missing-url.pdf", contentType: "application/pdf" },
        { name: "", contentType: "", url: "https://example.com/file.bin" },
      ])
    ).toEqual([
      {
        type: "file",
        filename: "file",
        mediaType: "application/octet-stream",
        url: "https://example.com/file.bin",
      },
    ])
  })
})
