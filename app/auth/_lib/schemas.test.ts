import { describe, expect, it } from "vitest"
import {
  fieldErrorsFromZodError,
  loginSchema,
  magicAuthStartSchema,
  magicAuthVerifySchema,
  signUpSchema,
  verifyEmailSchema,
} from "./schemas"

describe("auth form schemas", () => {
  it("normalizes login email addresses", () => {
    const parsed = loginSchema.parse({
      email: " Person@Example.COM ",
      password: "password",
    })

    expect(parsed.email).toBe("person@example.com")
  })

  it("returns a confirm password field error for mismatched signup passwords", () => {
    const parsed = signUpSchema.safeParse({
      name: "Person",
      email: "person@example.com",
      password: "password123",
      confirmPassword: "different",
    })

    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(fieldErrorsFromZodError(parsed.error)).toMatchObject({
        confirmPassword: "Passwords do not match.",
      })
    }
  })

  it("requires a 6-digit email verification code", () => {
    expect(verifyEmailSchema.safeParse({ code: "123456" }).success).toBe(true)
    expect(verifyEmailSchema.safeParse({ code: "12345a" }).success).toBe(false)
  })

  it("normalizes magic auth email addresses", () => {
    const parsed = magicAuthStartSchema.parse({
      email: " Person@Example.COM ",
    })

    expect(parsed.email).toBe("person@example.com")
  })

  it("requires magic auth email and 6-digit code", () => {
    expect(
      magicAuthVerifySchema.safeParse({
        email: "person@example.com",
        code: "123456",
      }).success
    ).toBe(true)
    expect(
      magicAuthVerifySchema.safeParse({
        email: "person@example.com",
        code: "abc123",
      }).success
    ).toBe(false)
  })
})
