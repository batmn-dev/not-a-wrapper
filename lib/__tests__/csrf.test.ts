import {
  generateCsrfToken,
  validateCsrfDoubleSubmit,
  validateCsrfToken,
} from "@/lib/csrf"
import { describe, expect, it } from "vitest"

// csrf.ts reads CSRF_SECRET lazily, so setting it here (module eval runs before
// the describe callbacks that generate tokens) is sufficient.
process.env.CSRF_SECRET = "test-csrf-secret-value"

describe("validateCsrfToken", () => {
  it("accepts a freshly generated token", () => {
    expect(validateCsrfToken(generateCsrfToken())).toBe(true)
  })

  it("rejects a token with a forged signature", () => {
    const [raw] = generateCsrfToken().split(":")
    expect(validateCsrfToken(`${raw}:deadbeef`)).toBe(false)
  })

  it("rejects a token whose random half was swapped (signature no longer matches)", () => {
    const good = generateCsrfToken()
    const [, sig] = good.split(":")
    expect(validateCsrfToken(`tampered-raw:${sig}`)).toBe(false)
  })

  it("rejects malformed tokens", () => {
    expect(validateCsrfToken("no-colon")).toBe(false)
    expect(validateCsrfToken("")).toBe(false)
    expect(validateCsrfToken(":")).toBe(false)
  })
})

describe("validateCsrfDoubleSubmit", () => {
  const token = generateCsrfToken()

  it("accepts a matching, validly-signed header+cookie pair", () => {
    expect(validateCsrfDoubleSubmit(token, token)).toBe(true)
  })

  it("accepts a pair when the header arrives URL-encoded but the cookie is decoded", () => {
    // Models the real transport: the client attaches `document.cookie`'s raw,
    // URL-encoded value as the header (the `:` delimiter becomes `%3A`), while the
    // server reads the cookie via next/headers, which URL-decodes it. A regression
    // here 403s every state-changing request.
    const encodedHeader = encodeURIComponent(token)
    expect(encodedHeader).not.toBe(token) // guard: the token really does encode
    expect(validateCsrfDoubleSubmit(encodedHeader, token)).toBe(true)
  })

  it("rejects when the header is missing", () => {
    expect(validateCsrfDoubleSubmit(null, token)).toBe(false)
    expect(validateCsrfDoubleSubmit(undefined, token)).toBe(false)
    expect(validateCsrfDoubleSubmit("", token)).toBe(false)
  })

  it("rejects when the cookie is missing", () => {
    expect(validateCsrfDoubleSubmit(token, null)).toBe(false)
  })

  it("rejects when header and cookie disagree (attacker's own token vs victim cookie)", () => {
    const attackerToken = generateCsrfToken()
    expect(validateCsrfDoubleSubmit(attackerToken, token)).toBe(false)
  })

  it("rejects a matching pair that is not validly signed", () => {
    // Header equals cookie (an attacker who set both), but the signature is bogus.
    const forged = "aaaa:bbbb"
    expect(validateCsrfDoubleSubmit(forged, forged)).toBe(false)
  })
})
