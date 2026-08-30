import { describe, expect, it } from "vitest"
import { extractTextFromMessageParts } from "./parts"

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
