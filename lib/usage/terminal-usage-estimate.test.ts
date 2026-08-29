import { describe, expect, it } from "vitest"
import {
  CHAT_TITLE_INSTRUCTIONS,
  CHAT_TITLE_MAX_INPUT_CHARACTERS,
} from "../chat-title-prompt"
import {
  CHARS_PER_TOKEN,
  estimatePartialOutputTokens,
  estimateTitleInputTokens,
  PER_MESSAGE_OVERHEAD_TOKENS,
  TOOL_CALL_STRUCTURAL_OVERHEAD_TOKENS,
} from "./terminal-usage-estimate"

describe("estimatePartialOutputTokens", () => {
  it("counts text and reasoning characters at the shared chars/token rate", () => {
    const parts = [
      { type: "reasoning", text: "a".repeat(40) },
      { type: "text", text: "b".repeat(60) },
    ]
    expect(estimatePartialOutputTokens(parts)).toBe(100 / CHARS_PER_TOKEN)
  })

  it("counts tool-call names and arguments but never tool results", () => {
    const input = { query: "x".repeat(96) }
    const withResult = [
      {
        type: "tool-search",
        toolCallId: "call_1",
        input,
        output: { huge: "z".repeat(100_000) },
      },
    ]
    const withoutResult = [
      { type: "dynamic-tool", toolName: "search", toolCallId: "call_1", input },
    ]
    const expected =
      Math.ceil(("search".length + JSON.stringify(input).length) / 4) +
      TOOL_CALL_STRUCTURAL_OVERHEAD_TOKENS
    // Identical estimates: the result payload is not model output.
    expect(estimatePartialOutputTokens(withResult)).toBe(expected)
    expect(estimatePartialOutputTokens(withoutResult)).toBe(expected)
  })

  it("ignores non-output parts and malformed inputs", () => {
    expect(estimatePartialOutputTokens(null)).toBe(0)
    expect(estimatePartialOutputTokens("not-parts")).toBe(0)
    expect(
      estimatePartialOutputTokens([
        { type: "file", url: "data:application/pdf;base64,xxxx" },
        { type: "source-url", url: "https://example.com" },
        { type: "step-start" },
        42,
        null,
      ])
    ).toBe(0)
  })
})

describe("estimateTitleInputTokens", () => {
  it("prices the exact clipped prompt plus message overhead", () => {
    const text = "Explain quantum computing"
    const promptChars =
      CHAT_TITLE_INSTRUCTIONS.length +
      `<user-message>\n${text}\n</user-message>`.length
    expect(estimateTitleInputTokens(text)).toBe(
      Math.ceil(promptChars / CHARS_PER_TOKEN) + 2 * PER_MESSAGE_OVERHEAD_TOKENS
    )
  })

  it("is bounded by the title input clip for very long user text", () => {
    const clipped = estimateTitleInputTokens(
      "y".repeat(CHAT_TITLE_MAX_INPUT_CHARACTERS * 5)
    )
    expect(clipped).toBe(
      estimateTitleInputTokens("y".repeat(CHAT_TITLE_MAX_INPUT_CHARACTERS))
    )
  })
})
