import { afterEach, describe, expect, it } from "vitest"
import { getPerfAuthPassword } from "./ensure-auth-user"

const originalPassword = process.env.PERF_AUTH_PASSWORD

afterEach(() => {
  if (originalPassword === undefined) {
    delete process.env.PERF_AUTH_PASSWORD
  } else {
    process.env.PERF_AUTH_PASSWORD = originalPassword
  }
})

describe("getPerfAuthPassword", () => {
  it("rejects a missing benchmark credential", () => {
    delete process.env.PERF_AUTH_PASSWORD

    expect(() => getPerfAuthPassword()).toThrow("PERF_AUTH_PASSWORD missing")
  })

  it("returns the configured benchmark credential", () => {
    process.env.PERF_AUTH_PASSWORD = "test-only-password"

    expect(getPerfAuthPassword()).toBe("test-only-password")
  })
})
