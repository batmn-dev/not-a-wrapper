import { describe, expect, it, vi } from "vitest"
import { truncateToolResult } from "../truncation"

// Mock the config module to control MAX_TOOL_RESULT_SIZE in tests
vi.mock("@/lib/config", () => ({
  MAX_TOOL_RESULT_SIZE: 100 * 1024, // 100KB default
}))

describe("truncateToolResult", () => {
  // ===========================================================================
  // No truncation needed
  // ===========================================================================

  describe("results within size limit", () => {
    it("returns string results unchanged when under limit", () => {
      const result = "Hello, world!"
      expect(truncateToolResult(result, 1024)).toBe(result)
    })

    it("returns empty string for null", () => {
      expect(truncateToolResult(null, 1024)).toBe("")
    })

    it("returns empty string for undefined", () => {
      expect(truncateToolResult(undefined, 1024)).toBe("")
    })

    it("serializes object results to JSON when under limit", () => {
      const obj = { key: "value", count: 42 }
      expect(truncateToolResult(obj, 1024)).toBe(JSON.stringify(obj))
    })

    it("serializes array results to JSON when under limit", () => {
      const arr = [1, 2, 3, "four"]
      expect(truncateToolResult(arr, 1024)).toBe(JSON.stringify(arr))
    })

    it("handles boolean results", () => {
      expect(truncateToolResult(true, 1024)).toBe("true")
    })

    it("handles number results", () => {
      expect(truncateToolResult(42, 1024)).toBe("42")
    })
  })

  // ===========================================================================
  // Truncation of large results
  // ===========================================================================

  describe("results exceeding size limit", () => {
    it("truncates strings over the byte limit", () => {
      const largeString = "a".repeat(200)
      const result = truncateToolResult(largeString, 100)

      expect(result.length).toBeLessThan(200)
      expect(result).toContain("[Result truncated")
    })

    it("preserves content up to the limit", () => {
      const largeString = "abcdefghij".repeat(20) // 200 chars
      const result = truncateToolResult(largeString, 100)

      // The result starts with the original content
      expect(result.startsWith("abcdefghij")).toBe(true)
      expect(result).toContain("[Result truncated")
    })

    it("truncates large JSON objects", () => {
      const largeObj = {
        data: "x".repeat(200),
        more: "y".repeat(200),
      }
      const result = truncateToolResult(largeObj, 100)

      expect(result).toContain("[Result truncated")
      expect(new TextEncoder().encode(result).length).toBeLessThanOrEqual(
        100 + 100 // some tolerance for the suffix
      )
    })

    it("truncates exactly at the 100KB default limit", () => {
      const exactlyOver = "a".repeat(100 * 1024 + 1) // 100KB + 1 byte
      const result = truncateToolResult(exactlyOver)

      const resultBytes = new TextEncoder().encode(result).length
      expect(resultBytes).toBeLessThanOrEqual(100 * 1024)
      expect(result).toContain("[Result truncated")
    })

    it("does not truncate exactly at the 100KB limit", () => {
      const exactlyAt = "a".repeat(100 * 1024) // exactly 100KB
      const result = truncateToolResult(exactlyAt)

      expect(result).toBe(exactlyAt)
      expect(result).not.toContain("[Result truncated")
    })
  })

  // ===========================================================================
  // Multi-byte character handling
  // ===========================================================================

  describe("multi-byte characters", () => {
    it("correctly handles emoji (4-byte UTF-8)", () => {
      // Each emoji is 4 bytes in UTF-8
      const emojis = "😀".repeat(30) // 120 bytes (30 × 4)
      const result = truncateToolResult(emojis, 100)

      // Result bytes should not exceed limit
      const resultBytes = new TextEncoder().encode(result).length
      expect(resultBytes).toBeLessThanOrEqual(100)
      expect(result).toContain("[Result truncated")
    })

    it("does not split multi-byte characters", () => {
      // Create a string with mixed ASCII and multi-byte chars
      const mixed = "Hello " + "世界".repeat(50) // mixed ASCII and CJK
      const result = truncateToolResult(mixed, 100)

      // The result should be valid UTF-8 (no broken sequences)
      // This is ensured by slicing at character boundaries
      const decoded = new TextDecoder().decode(new TextEncoder().encode(result))
      expect(decoded).toBe(result)
    })

    it("handles CJK characters (3-byte UTF-8)", () => {
      const cjk = "中".repeat(40) // 120 bytes (40 × 3)
      const result = truncateToolResult(cjk, 100)

      const resultBytes = new TextEncoder().encode(result).length
      expect(resultBytes).toBeLessThanOrEqual(100)
    })
  })

  // ===========================================================================
  // Edge cases
  // ===========================================================================

  describe("edge cases", () => {
    it("handles maxSize smaller than truncation suffix", () => {
      const text = "Hello, world!"
      const result = truncateToolResult(text, 10)

      // Must respect the size guarantee even when maxSize < suffix length
      const resultBytes = new TextEncoder().encode(result).length
      expect(resultBytes).toBeLessThanOrEqual(10)
      expect(result).toBe("Hello, wor")
    })

    it("handles maxSize of 1", () => {
      const result = truncateToolResult("Hello", 1)
      const resultBytes = new TextEncoder().encode(result).length
      expect(resultBytes).toBeLessThanOrEqual(1)
      expect(result).toBe("H")
    })

    it("handles maxSize of 0", () => {
      const result = truncateToolResult("Hello", 0)
      expect(result).toBe("")
    })

    it("handles circular references gracefully", () => {
      // JSON.stringify throws on circular refs — should fall back to String()
      const circular: Record<string, unknown> = { a: 1 }
      circular.self = circular

      const result = truncateToolResult(circular, 1024)
      expect(typeof result).toBe("string")
    })

    it("handles empty string input", () => {
      expect(truncateToolResult("", 100)).toBe("")
    })

    it("uses MAX_TOOL_RESULT_SIZE as default", () => {
      // A string slightly under 100KB should not be truncated
      const underLimit = "a".repeat(100 * 1024 - 1)
      const result = truncateToolResult(underLimit)
      expect(result).toBe(underLimit)
    })
  })
})
