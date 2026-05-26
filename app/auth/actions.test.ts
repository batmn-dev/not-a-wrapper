import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  signInWithPasswordSession,
  verifyEmailCodeSession,
  verifyMagicAuthCodeSession,
} from "./_lib/workos-password-auth"
import {
  signInWithPassword,
  verifyEmailCode,
  verifyMagicAuthCode,
} from "./actions"

vi.mock("next/headers", () => ({
  headers: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}))

vi.mock("./_lib/workos-password-auth", () => ({
  requestPasswordResetEmail: vi.fn(),
  resetPasswordWithToken: vi.fn(),
  signInWithPasswordSession: vi.fn(),
  signUpWithPasswordSession: vi.fn(),
  startMagicAuthSession: vi.fn(),
  verifyEmailCodeSession: vi.fn(),
  verifyMagicAuthCodeSession: vi.fn(),
}))

describe("auth actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("uses the first forwarded protocol value when building request context", async () => {
    vi.mocked(headers).mockResolvedValue(
      new Headers({
        host: "internal.not-a-wrapper.test",
        "user-agent": "vitest",
        "x-forwarded-for": "203.0.113.10, 10.0.0.1",
        "x-forwarded-host": "not-a-wrapper.test",
        "x-forwarded-proto": "https, http",
      })
    )
    vi.mocked(signInWithPasswordSession).mockResolvedValue({
      status: "invalid-credentials",
      message: "Invalid email or password.",
    })

    const formData = new FormData()
    formData.set("email", "Person@Example.com")
    formData.set("password", "password123")

    await signInWithPassword({ status: "idle" }, formData)

    expect(signInWithPasswordSession).toHaveBeenCalledWith(
      { email: "person@example.com", password: "password123" },
      {
        requestUrl: "https://not-a-wrapper.test/auth/login",
        ipAddress: "203.0.113.10",
        userAgent: "vitest",
      }
    )
  })

  it("returns an authenticated state after password sign-in saves a session", async () => {
    vi.mocked(headers).mockResolvedValue(
      new Headers({
        host: "localhost:3000",
        "user-agent": "vitest",
      })
    )
    vi.mocked(signInWithPasswordSession).mockResolvedValue({
      status: "authenticated",
    })

    const formData = new FormData()
    formData.set("email", "Person@Example.com")
    formData.set("password", "password123")

    const state = await signInWithPassword({ status: "idle" }, formData)

    expect(state).toEqual({ status: "authenticated", redirectTo: "/" })
    expect(redirect).not.toHaveBeenCalled()
  })

  it("returns an authenticated state after magic code verification saves a session", async () => {
    vi.mocked(headers).mockResolvedValue(
      new Headers({
        host: "localhost:3000",
        "user-agent": "vitest",
      })
    )
    vi.mocked(verifyMagicAuthCodeSession).mockResolvedValue({
      status: "authenticated",
    })

    const formData = new FormData()
    formData.set("email", "Person@Example.com")
    formData.set("code", "123456")

    const state = await verifyMagicAuthCode({ status: "idle" }, formData)

    expect(state).toEqual({ status: "authenticated", redirectTo: "/" })
    expect(redirect).not.toHaveBeenCalled()
  })

  it("returns an authenticated state after email verification saves a session", async () => {
    vi.mocked(headers).mockResolvedValue(
      new Headers({
        host: "localhost:3000",
        "user-agent": "vitest",
      })
    )
    vi.mocked(verifyEmailCodeSession).mockResolvedValue({
      status: "verified",
    })

    const formData = new FormData()
    formData.set("code", "123456")

    const state = await verifyEmailCode({ status: "idle" }, formData)

    expect(state).toEqual({ status: "authenticated", redirectTo: "/" })
    expect(redirect).not.toHaveBeenCalled()
  })
})
