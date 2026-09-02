import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server"
import { describe, expect, it, vi } from "vitest"
import { config } from "./proxy"

vi.mock("@workos-inc/authkit-nextjs", () => ({
  authkitProxy: () => vi.fn(),
}))

function matches(url: string) {
  return unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })
}

describe("AuthKit proxy coverage", () => {
  it("covers asset-like misses that render the root layout", () => {
    expect(matches("https://not-a-wrapper.com/config.js")).toBe(true)
  })

  it("leaves Next static assets and the favicon untouched", () => {
    expect(
      matches("https://not-a-wrapper.com/_next/static/chunks/app.js")
    ).toBe(false)
    expect(
      matches("https://not-a-wrapper.com/_next/image?url=%2Fbanner_ocean.jpg")
    ).toBe(false)
    expect(matches("https://not-a-wrapper.com/favicon.ico")).toBe(false)
  })
})
