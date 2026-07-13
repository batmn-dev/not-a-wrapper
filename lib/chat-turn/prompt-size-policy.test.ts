import { describe, expect, it } from "vitest"
import { evaluatePromptSize } from "./prompt-size-policy"

describe("evaluatePromptSize", () => {
  it("allows direct text over 10,000 characters when the model budget fits", () => {
    expect(
      evaluatePromptSize({
        modelId: "gpt-5.4-mini",
        systemPrompt: "system",
        nextText: "x".repeat(10_001),
      }).ok
    ).toBe(true)
  })

  it("uses the selected model context instead of a universal character limit", () => {
    const decision = evaluatePromptSize({
      modelId: "gemma-3-27b-it",
      systemPrompt: "system",
      nextText: "x".repeat(30_000),
    })

    expect(decision).toMatchObject({
      ok: false,
      effectiveInputTokens: Math.floor(8192 * 0.9),
    })
  })

  it("conservatively includes history and text attachment input", () => {
    expect(
      evaluatePromptSize({
        modelId: "gemma-3-27b-it",
        systemPrompt: "system",
        messages: [
          {
            parts: [
              { type: "text", text: "prior" },
              { type: "file", mediaType: "text/plain" },
            ],
          },
        ],
        nextText: "next",
      }).ok
    ).toBe(false)
  })
})
