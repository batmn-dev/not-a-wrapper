import { afterEach, describe, expect, it } from "vitest"
import {
  DEFAULT_AGENT_EMAIL,
  assertLandedOnAuthOrigin,
  assertSafeAuthOrigin,
  getAgentCredentials,
} from "./agent-auth"

const originalPassword = process.env.PERF_AUTH_PASSWORD
const originalEmail = process.env.PERF_AUTH_EMAIL
const originalAuthOrigin = process.env.AGENT_AUTH_ORIGIN
const originalRedirect = process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI

function restore(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

afterEach(() => {
  restore("PERF_AUTH_PASSWORD", originalPassword)
  restore("PERF_AUTH_EMAIL", originalEmail)
  restore("AGENT_AUTH_ORIGIN", originalAuthOrigin)
  restore("NEXT_PUBLIC_WORKOS_REDIRECT_URI", originalRedirect)
})

describe("getAgentCredentials", () => {
  it("rejects a missing password", () => {
    delete process.env.PERF_AUTH_PASSWORD
    expect(() => getAgentCredentials()).toThrow("PERF_AUTH_PASSWORD is not set")
  })

  it("rejects a password shorter than 10 characters", () => {
    process.env.PERF_AUTH_PASSWORD = "short"
    expect(() => getAgentCredentials()).toThrow("at least 10")
  })

  it("returns the configured credentials", () => {
    process.env.PERF_AUTH_PASSWORD = "test-only-password"
    delete process.env.PERF_AUTH_EMAIL
    expect(getAgentCredentials()).toEqual({
      email: DEFAULT_AGENT_EMAIL,
      password: "test-only-password",
    })
  })
})

describe("assertSafeAuthOrigin", () => {
  it("allows loopback http and https", () => {
    expect(assertSafeAuthOrigin("http://localhost:3000")).toBe(
      "http://localhost:3000"
    )
    expect(assertSafeAuthOrigin("http://127.0.0.1:3000/path")).toBe(
      "http://127.0.0.1:3000"
    )
    expect(assertSafeAuthOrigin("http://[::1]:3000")).toBe("http://[::1]:3000")
    expect(assertSafeAuthOrigin("https://localhost")).toBe("https://localhost")
  })

  it("rejects invalid and non-http URLs", () => {
    expect(() => assertSafeAuthOrigin("not-a-url")).toThrow("Invalid")
    expect(() => assertSafeAuthOrigin("file:///tmp")).toThrow("http or https")
  })

  it("rejects plaintext remote origins", () => {
    expect(() => assertSafeAuthOrigin("http://evil.example")).toThrow(
      "non-loopback http"
    )
  })

  it("rejects remote https unless allowlisted", () => {
    delete process.env.AGENT_AUTH_ORIGIN
    delete process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI
    expect(() => assertSafeAuthOrigin("https://evil.example")).toThrow(
      "AGENT_AUTH_ORIGIN"
    )
  })

  it("allows remote https when AGENT_AUTH_ORIGIN matches", () => {
    process.env.AGENT_AUTH_ORIGIN = "https://preview.example"
    expect(assertSafeAuthOrigin("https://preview.example/chat")).toBe(
      "https://preview.example"
    )
  })
})

describe("assertLandedOnAuthOrigin", () => {
  it("allows the same origin after navigation", () => {
    expect(() =>
      assertLandedOnAuthOrigin(
        "http://localhost:3000/auth/login",
        "http://localhost:3000"
      )
    ).not.toThrow()
  })

  it("rejects a cross-origin redirect", () => {
    expect(() =>
      assertLandedOnAuthOrigin(
        "https://evil.example/phish",
        "http://localhost:3000"
      )
    ).toThrow("untrusted origin")
  })
})
