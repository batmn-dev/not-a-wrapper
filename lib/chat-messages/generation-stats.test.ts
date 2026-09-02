import { describe, expect, it } from "vitest"
import {
  deriveGenerationStatsView,
  formatMsAsSeconds,
  formatTokenCount,
  formatTokensPerSecond,
  parseGenerationStats,
} from "./generation-stats"

describe("parseGenerationStats", () => {
  it("keeps valid fields and drops malformed or unknown ones", () => {
    expect(
      parseGenerationStats({
        timeToFirstTokenMs: 420.5,
        outputTokens: 146,
        reasoningTokens: -1,
        inputTokens: 1.5,
        stepCount: Number.NaN,
        bogus: 1,
      })
    ).toEqual({ timeToFirstTokenMs: 420.5, outputTokens: 146 })
    expect(parseGenerationStats({})).toBeUndefined()
    expect(parseGenerationStats("nope")).toBeUndefined()
  })
})

describe("deriveGenerationStatsView", () => {
  it("derives the rate from the output window and never stores it", () => {
    const view = deriveGenerationStatsView({
      timeToFirstTokenMs: 420,
      outputStreamMs: 4223,
      outputTokens: 146,
    })
    expect(view.kind).toBe("complete")
    if (view.kind !== "complete") return
    expect(view.tokensPerSecond).toBeCloseTo(34.57, 2)
  })

  it("rates visible tokens only: hidden reasoning is generated before the window", () => {
    // 271 output tokens of which 128 are reasoning over a 1,284 ms window —
    // the live GPT-5 Mini case. Counting the reasoning would read 211 tok/s
    // for text that streamed at 111.
    const view = deriveGenerationStatsView({
      timeToFirstTokenMs: 3730,
      outputStreamMs: 1284,
      outputTokens: 271,
      reasoningTokens: 128,
    })
    expect(view.kind).toBe("complete")
    if (view.kind !== "complete") return
    expect(view.visibleOutputTokens).toBe(143)
    expect(view.tokensPerSecond).toBeCloseTo(111.37, 2)
    // Nothing visible → no rate, never a fabricated one.
    const hiddenOnly = deriveGenerationStatsView({
      outputStreamMs: 500,
      outputTokens: 20,
      reasoningTokens: 20,
    })
    expect(hiddenOnly.kind === "complete" && hiddenOnly.tokensPerSecond).toBe(
      undefined
    )
  })

  it("cannot fabricate a rate from a zero window", () => {
    const view = deriveGenerationStatsView({
      outputStreamMs: 0,
      outputTokens: 1,
    })
    expect(view.kind === "complete" && view.tokensPerSecond).toBeUndefined()
  })

  it("shows time to first token alone when the provider omitted usage", () => {
    expect(deriveGenerationStatsView({ timeToFirstTokenMs: 300 })).toEqual({
      kind: "tokens-unavailable",
      timeToFirstTokenMs: 300,
    })
    expect(deriveGenerationStatsView(undefined)).toEqual({ kind: "none" })
    expect(deriveGenerationStatsView({ stepCount: 1 })).toEqual({
      kind: "none",
    })
  })
})

describe("formatting", () => {
  it("rounds to the agreed precision", () => {
    expect(formatTokensPerSecond(34.5738)).toBe("34.6")
    expect(formatMsAsSeconds(420)).toBe("0.42")
    expect(formatTokenCount(12345)).toBe("12,345")
  })
})
