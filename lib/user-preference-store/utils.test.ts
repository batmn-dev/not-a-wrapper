import { describe, expect, it } from "vitest"
import { convertFromApiFormat, convertToApiFormat } from "./utils"

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
