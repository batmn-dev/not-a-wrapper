import { headers } from "next/headers"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { signInWithPasswordSession } from "./_lib/workos-password-auth"
import { signInWithPassword } from "./actions"

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
})
