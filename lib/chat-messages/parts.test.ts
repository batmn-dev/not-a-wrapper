import { describe, expect, it } from "vitest"
import { extractTextFromMessageParts, getMessagePartsForDisplay } from "./parts"

describe("extractTextFromMessageParts", () => {
  it("returns an empty string for empty or missing parts", () => {
    expect(extractTextFromMessageParts(undefined)).toBe("")
    expect(extractTextFromMessageParts(null)).toBe("")
    expect(extractTextFromMessageParts([])).toBe("")
  })

  it("concatenates text parts in order", () => {
    expect(
      extractTextFromMessageParts([
        { type: "text", text: "hello" },
        { type: "text", text: " world" },
      ])
    ).toBe("hello world")
  })

  it("ignores non-text, malformed, provider, tool, and file parts", () => {
    expect(
      extractTextFromMessageParts([
        { type: "reasoning", text: "hidden thought" },
        { type: "tool-search", state: "output-available", output: "result" },
        { type: "file", filename: "notes.txt", url: "https://example.com" },
        { type: "text", text: "visible" },
        { type: "text", text: 123 },
        null,
        "text",
      ])
    ).toBe("visible")
  })
})

describe("getMessagePartsForDisplay", () => {
  it("uses stored text parts when present", () => {
    const parts = [{ type: "text" as const, text: "stored" }]

    expect(getMessagePartsForDisplay({ content: "legacy", parts })).toBe(parts)
  })

  it("falls back to content text for legacy rows without parts", () => {
    expect(getMessagePartsForDisplay({ content: "legacy", parts: [] })).toEqual(
      [{ type: "text", text: "legacy" }]
    )
  })

  it("bridges legacy attachments into file parts", () => {
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

  it("does not duplicate legacy attachments when file parts already exist", () => {
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

  it("bridges legacy attachments when stored parts contain malformed entries", () => {
    expect(
      getMessagePartsForDisplay({
        content: "",
        parts: [null, { type: "text", text: "see attached" }],
        attachments: [
          {
            name: "receipt.pdf",
            contentType: "application/pdf",
            url: "https://example.com/receipt.pdf",
          },
        ],
      })
    ).toEqual([
      null,
      { type: "text", text: "see attached" },
      {
        type: "file",
        filename: "receipt.pdf",
        mediaType: "application/pdf",
        url: "https://example.com/receipt.pdf",
      },
    ])
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
