import { describe, expect, it } from "vitest"
import {
  convertFromApiFormat,
  convertToApiFormat,
  normalizeHiddenModels,
  normalizeStreamingPresentation,
} from "./utils"

describe("user preference webSearchEnabled defaults", () => {
  it("defaults webSearchEnabled to false when missing", () => {
    const converted = convertFromApiFormat({})
    expect(converted.webSearchEnabled).toBe(false)
  })

  it("round-trips an explicit disabled preference", () => {
    const apiPreference = convertToApiFormat({ webSearchEnabled: false })
    expect(apiPreference).toEqual({
      web_search_enabled: false,
    })
    expect(convertFromApiFormat(apiPreference).webSearchEnabled).toBe(false)
  })
})

describe("user preference streamingPresentation", () => {
  it("defaults to smooth when missing and normalizes unknown values", () => {
    expect(convertFromApiFormat({}).streamingPresentation).toBe("smooth")
    expect(normalizeStreamingPresentation("bogus")).toBe("smooth")
    expect(normalizeStreamingPresentation(undefined)).toBe("smooth")
    expect(normalizeStreamingPresentation("quick")).toBe("quick")
  })

  it("round-trips an explicit quick preference", () => {
    const apiPreference = convertToApiFormat({ streamingPresentation: "quick" })
    expect(apiPreference).toEqual({ streaming_presentation: "quick" })
    expect(convertFromApiFormat(apiPreference).streamingPresentation).toBe(
      "quick"
    )
  })
})

describe("user preference hiddenModels", () => {
  it("normalizes legacy wrapped route ids to logical model ids", () => {
    const hiddenModels = [
      "openrouter:anthropic/claude-sonnet-5",
      "claude-sonnet-5",
      "gpt-5.4",
    ]

    expect(normalizeHiddenModels(hiddenModels)).toEqual([
      "claude-sonnet-5",
      "gpt-5.4",
    ])
    expect(
      convertFromApiFormat({ hidden_models: hiddenModels }).hiddenModels
    ).toEqual(["claude-sonnet-5", "gpt-5.4"])
  })
})
