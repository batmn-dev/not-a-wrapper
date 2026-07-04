import { describe, expect, it } from "vitest"
import { findSemanticBoundary } from "../truncation-policy"

describe("findSemanticBoundary", () => {
  it("returns boundary after LF paragraph marker", () => {
    const text = "Alpha section\n\nBeta section continues with more text."
    const maxChars = text.length - 5

    const boundary = findSemanticBoundary(text, maxChars)
    const markerIndex = text.indexOf("\n\n")

    expect(markerIndex).toBeGreaterThanOrEqual(0)
    expect(boundary).toBe(markerIndex + 2)
  })

  it("returns boundary after full CRLF paragraph marker", () => {
    const text = "Alpha section\r\n\r\nBeta section continues with more text."
    const maxChars = text.length - 5

    const boundary = findSemanticBoundary(text, maxChars)
    const markerIndex = text.indexOf("\r\n\r\n")

    expect(markerIndex).toBeGreaterThanOrEqual(0)
    expect(boundary).toBe(markerIndex + 4)
  })
})
