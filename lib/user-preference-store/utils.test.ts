import { describe, expect, it } from "vitest"
import {
  convertFromApiFormat,
  convertToApiFormat,
  normalizeStreamingPresentation,
} from "./utils"

describe("user preference webSearchEnabled defaults", () => {
  it("defaults webSearchEnabled to true when missing", () => {
    const converted = convertFromApiFormat({})
    expect(converted.webSearchEnabled).toBe(true)
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
