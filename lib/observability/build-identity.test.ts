import { describe, expect, it } from "vitest"
import { resolveBuildId } from "./build-identity"

describe("resolveBuildId", () => {
  it("shortens the Vercel commit SHA and prefers it over the Sentry release", () => {
    expect(
      resolveBuildId({
        VERCEL_GIT_COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
        SENTRY_RELEASE: "not-a-wrapper@1.2.3",
      })
    ).toBe("0123456789ab")
  })

  it("falls back to the release and resolves to undefined locally", () => {
    expect(resolveBuildId({ SENTRY_RELEASE: "not-a-wrapper@1.2.3" })).toBe(
      "not-a-wrapper@1.2.3"
    )
    expect(
      resolveBuildId({
        VERCEL_GIT_COMMIT_SHA: "  ",
        SENTRY_RELEASE: "not-a-wrapper@1.2.3",
      })
    ).toBe("not-a-wrapper@1.2.3")
    expect(resolveBuildId({ SENTRY_RELEASE: "has spaces" })).toBeUndefined()
    expect(resolveBuildId({})).toBeUndefined()
  })
})
