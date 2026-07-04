import { describe, expect, it } from "vitest"
import { toSafeWebHref } from "./url-safety"

describe("toSafeWebHref", () => {
  it("returns normalized http and https URLs", () => {
    expect(toSafeWebHref(" https://example.com/path ")).toBe(
      "https://example.com/path"
    )
    expect(toSafeWebHref("http://example.com")).toBe("http://example.com/")
    expect(toSafeWebHref("//example.com/path")).toBe("https://example.com/path")
  })

  it("rejects non-web and relative URLs", () => {
    expect(toSafeWebHref("javascript:alert(1)")).toBeNull()
    expect(toSafeWebHref("data:text/html,hello")).toBeNull()
    expect(toSafeWebHref("mailto:support@example.com")).toBeNull()
    expect(toSafeWebHref("/internal")).toBeNull()
  })
})
