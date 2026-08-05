import { afterEach, describe, expect, it, vi } from "vitest"
import { getConvexSiteUrl } from "./convex-site-url"

describe("getConvexSiteUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("prefers the explicit CONVEX_SITE_URL", () => {
    vi.stubEnv("CONVEX_SITE_URL", "https://site.example")
    vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", "http://127.0.0.1:3211")
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://deployment.convex.cloud")

    expect(getConvexSiteUrl()).toBe("https://site.example")
  })

  it("falls back to the generated NEXT_PUBLIC_CONVEX_SITE_URL", () => {
    vi.stubEnv("CONVEX_SITE_URL", "")
    vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", "http://127.0.0.1:3211")
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "http://127.0.0.1:3210")

    expect(getConvexSiteUrl()).toBe("http://127.0.0.1:3211")
  })

  it("derives the .convex.site twin from a hosted deployment URL", () => {
    vi.stubEnv("CONVEX_SITE_URL", "")
    vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", "")
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://happy-animal-123.convex.cloud")

    expect(getConvexSiteUrl()).toBe("https://happy-animal-123.convex.site")
  })

  it("fails loud when the deployment URL has no derivable site twin", () => {
    vi.stubEnv("CONVEX_SITE_URL", "")
    vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", "")
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "http://127.0.0.1:3210")

    expect(() => getConvexSiteUrl()).toThrow(
      "Cannot derive the Convex site URL"
    )
  })

  it("fails loud when no Convex URL is configured at all", () => {
    vi.stubEnv("CONVEX_SITE_URL", "")
    vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", "")
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "")

    expect(() => getConvexSiteUrl()).toThrow(
      "NEXT_PUBLIC_CONVEX_URL is not set"
    )
  })
})
