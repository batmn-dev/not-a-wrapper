import { describe, expect, it } from "vitest"
import { resolveSourceLinkDestination, toSafeWebHref } from "./url-safety"

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

describe("resolveSourceLinkDestination", () => {
  it("preserves signature-sensitive source URLs", () => {
    const signedUrl =
      "https://example.com/research?X-Amz-Credential=user%2Fscope&X-Amz-Signature=abc123"
    const destination = resolveSourceLinkDestination(signedUrl)

    expect(destination).toMatchObject({
      target: "_blank",
      rel: "noopener noreferrer",
    })
    expect(destination?.url.toString()).toBe(signedUrl)
    expect(destination?.href).toBe(signedUrl)
    expect(resolveSourceLinkDestination("javascript:alert(1)")).toBeNull()
  })
})
