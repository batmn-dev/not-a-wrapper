import { describe, expect, it } from "vitest"
import { getMessagePartsForDisplay } from "./message-parts"

describe("getMessagePartsForDisplay", () => {
  it("maps legacy attachments into file parts for display", () => {
    expect(
      getMessagePartsForDisplay({
        content: "",
        parts: [],
        attachments: [
          {
            name: "receipt.pdf",
            contentType: "application/pdf",
            url: "https://example.com/receipt.pdf",
          },
        ],
      })
    ).toEqual([
      {
        type: "file",
        filename: "receipt.pdf",
        mediaType: "application/pdf",
        url: "https://example.com/receipt.pdf",
      },
    ])
  })

  it("does not duplicate attachments when file parts already exist", () => {
    const filePart = {
      type: "file" as const,
      filename: "photo.png",
      mediaType: "image/png",
      url: "https://example.com/photo.png",
    }

    expect(
      getMessagePartsForDisplay({
        content: "",
        parts: [filePart],
        attachments: [
          {
            name: "legacy-photo.png",
            contentType: "image/png",
            url: "https://example.com/legacy-photo.png",
          },
        ],
      })
    ).toEqual([filePart])
  })

  it("falls back to content text when legacy rows have no parts", () => {
    expect(
      getMessagePartsForDisplay({
        content: "hello",
        parts: null,
        attachments: [],
      })
    ).toEqual([{ type: "text", text: "hello" }])
  })

  it("ignores malformed legacy attachments", () => {
    expect(
      getMessagePartsForDisplay({
        content: "",
        parts: [],
        attachments: [
          null,
          { name: "missing-url.pdf", contentType: "application/pdf" },
          { name: "", contentType: "", url: "https://example.com/file.bin" },
        ],
      })
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
