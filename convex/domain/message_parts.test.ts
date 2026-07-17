import { describe, expect, it } from "vitest"
import { extractTextFromMessageParts } from "./message_parts"

describe("Convex message parts helpers", () => {
  it("extracts text from valid text parts only", () => {
    expect(
      extractTextFromMessageParts([
        { type: "text", text: "hello" },
        { type: "reasoning", text: "hidden" },
        { type: "text", text: " world" },
        { type: "file", filename: "receipt.pdf" },
        { type: "text", text: 123 },
        null,
      ])
    ).toBe("hello world")
  })

  it("returns empty text for missing or malformed parts", () => {
    expect(extractTextFromMessageParts(undefined)).toBe("")
    expect(extractTextFromMessageParts({ type: "text", text: "ignored" })).toBe(
      ""
    )
  })

})
