import { beforeEach, describe, expect, it, vi } from "vitest"
import type { WorkosAuthDependencies } from "./workos-password-auth"
import {
  requestPasswordResetEmail,
  resetPasswordWithToken,
  signInWithPasswordSession,
  signUpWithPasswordSession,
  startMagicAuthSession,
  verifyEmailCodeSession,
  verifyMagicAuthCodeSession,
} from "./workos-password-auth"

vi.mock("server-only", () => ({}))
vi.mock("@workos-inc/authkit-nextjs", () => ({
  getWorkOS: vi.fn(),
  saveSession: vi.fn(),
}))

const context = {
  requestUrl: "https://not-a-wrapper.test/auth/login",
  ipAddress: "203.0.113.10",
  userAgent: "vitest",
}

const authResponse = {
  accessToken: "access_token",
  refreshToken: "refresh_token",
  user: {
    id: "user_123",
    email: "person@example.com",
  },
}

function createDependencies() {
  const dependencies = {
    clientId: "client_123",
    userManagement: {
      authenticateWithMagicAuth: vi.fn(),
      authenticateWithPassword: vi.fn(),
      authenticateWithEmailVerification: vi.fn(),
      createMagicAuth: vi.fn(),
      createUser: vi.fn(),
      createPasswordReset: vi.fn(),
      resetPassword: vi.fn(),
    },
    saveSession: vi.fn(),
    setEmailVerificationFlow: vi.fn(),
    getEmailVerificationFlow: vi.fn(),
    clearAuthFlow: vi.fn(),
  }

  return dependencies as unknown as WorkosAuthDependencies & {
    userManagement: {
      authenticateWithMagicAuth: ReturnType<typeof vi.fn>
      authenticateWithPassword: ReturnType<typeof vi.fn>
      authenticateWithEmailVerification: ReturnType<typeof vi.fn>
      createMagicAuth: ReturnType<typeof vi.fn>
      createUser: ReturnType<typeof vi.fn>
      createPasswordReset: ReturnType<typeof vi.fn>
      resetPassword: ReturnType<typeof vi.fn>
    }
    saveSession: ReturnType<typeof vi.fn>
    setEmailVerificationFlow: ReturnType<typeof vi.fn>
    getEmailVerificationFlow: ReturnType<typeof vi.fn>
    clearAuthFlow: ReturnType<typeof vi.fn>
  }
}

describe("WorkOS password auth helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("saves an AuthKit session after password sign-in succeeds", async () => {
    const dependencies = createDependencies()
    dependencies.userManagement.authenticateWithPassword.mockResolvedValue(
      authResponse
    )

    const result = await signInWithPasswordSession(
      { email: "person@example.com", password: "password123" },
      context,
      dependencies
    )

    expect(result).toEqual({ status: "authenticated" })
    expect(
      dependencies.userManagement.authenticateWithPassword
    ).toHaveBeenCalledWith({
      clientId: "client_123",
      email: "person@example.com",
      password: "password123",
      ipAddress: "203.0.113.10",
      userAgent: "vitest",
    })
    expect(dependencies.saveSession).toHaveBeenCalledWith(
      authResponse,
      context.requestUrl
    )
    expect(dependencies.clearAuthFlow).toHaveBeenCalled()
  })

  it("stores a pending auth token server-side when email verification is required", async () => {
    const dependencies = createDependencies()
    dependencies.userManagement.authenticateWithPassword.mockRejectedValue({
      status: 400,
      code: "email_verification_required",
      pendingAuthenticationToken: "pending_token_123",
    })

    const result = await signInWithPasswordSession(
      { email: "person@example.com", password: "password123" },
      context,
      dependencies
    )

    expect(result).toEqual({
      status: "email-verification-required",
      email: "person@example.com",
    })
    expect(dependencies.setEmailVerificationFlow).toHaveBeenCalledWith(
      "person@example.com",
      "pending_token_123"
    )
    expect(dependencies.saveSession).not.toHaveBeenCalled()
  })

  it("does not expose pending auth tokens for unsupported auth continuations", async () => {
    const dependencies = createDependencies()
    dependencies.userManagement.authenticateWithPassword.mockRejectedValue({
      status: 400,
      code: "mfa_challenge",
      pendingAuthenticationToken: "pending_token_secret",
    })

    const result = await signInWithPasswordSession(
      { email: "person@example.com", password: "password123" },
      context,
      dependencies
    )

    expect(result.status).toBe("unsupported")
    expect("message" in result ? result.message : "").not.toContain(
      "pending_token_secret"
    )
    expect(dependencies.setEmailVerificationFlow).not.toHaveBeenCalled()
    expect(dependencies.saveSession).not.toHaveBeenCalled()
  })

  it("maps invalid password auth to a generic credential error", async () => {
    const dependencies = createDependencies()
    dependencies.userManagement.authenticateWithPassword.mockRejectedValue({
      status: 401,
      message: "raw provider detail",
    })

    const result = await signInWithPasswordSession(
      { email: "person@example.com", password: "wrong-password" },
      context,
      dependencies
    )

    expect(result).toEqual({
      status: "invalid-credentials",
      message: "Invalid email or password.",
    })
  })

  it("creates a user and then continues into the verification flow", async () => {
    const dependencies = createDependencies()
    dependencies.userManagement.createUser.mockResolvedValue({ id: "user_123" })
    dependencies.userManagement.authenticateWithPassword.mockRejectedValue({
      status: 400,
      code: "email_verification_required",
      pendingAuthenticationToken: "pending_token_123",
    })

    const result = await signUpWithPasswordSession(
      {
        name: "Person Example",
        email: "person@example.com",
        password: "password123",
      },
      context,
      dependencies
    )

    expect(dependencies.userManagement.createUser).toHaveBeenCalledWith({
      email: "person@example.com",
      password: "password123",
      firstName: "Person",
      lastName: "Example",
    })
    expect(result.status).toBe("email-verification-required")
    expect(dependencies.setEmailVerificationFlow).toHaveBeenCalledWith(
      "person@example.com",
      "pending_token_123"
    )
  })

  it("starts magic auth without exposing the returned code", async () => {
    const dependencies = createDependencies()
    dependencies.userManagement.createMagicAuth.mockResolvedValue({
      code: "123456",
      email: "person@example.com",
    })

    const result = await startMagicAuthSession(
      { email: "person@example.com" },
      dependencies
    )

    expect(result).toEqual({ status: "sent" })
    expect(dependencies.userManagement.createMagicAuth).toHaveBeenCalledWith({
      email: "person@example.com",
    })
    expect(JSON.stringify(result)).not.toContain("123456")
    expect(dependencies.clearAuthFlow).toHaveBeenCalled()
  })

  it("maps magic auth start rate limits to a generic rate limit message", async () => {
    const dependencies = createDependencies()
    dependencies.userManagement.createMagicAuth.mockRejectedValue({
      status: 429,
      message: "raw provider rate limit",
    })

    await expect(
      startMagicAuthSession({ email: "person@example.com" }, dependencies)
    ).resolves.toEqual({
      status: "rate-limited",
      message: "Too many attempts. Try again later.",
    })
  })

  it("maps disabled magic auth to a password fallback without exposing provider details", async () => {
    const dependencies = createDependencies()
    dependencies.userManagement.createMagicAuth.mockRejectedValue({
      status: 400,
      message: "Error Description: Magic Auth is disabled.",
    })

    const result = await startMagicAuthSession(
      { email: "person@example.com" },
      dependencies
    )

    expect(result).toEqual({
      status: "unavailable",
      message:
        "Email code sign-in is not enabled yet. Continue with password instead.",
    })
    expect(JSON.stringify(result)).not.toContain("Magic Auth is disabled")
    expect(dependencies.clearAuthFlow).not.toHaveBeenCalled()
  })

  it("saves a session after magic auth verification succeeds", async () => {
    const dependencies = createDependencies()
    dependencies.userManagement.authenticateWithMagicAuth.mockResolvedValue(
      authResponse
    )

    const result = await verifyMagicAuthCodeSession(
      { email: "person@example.com", code: "123456" },
      context,
      dependencies
    )

    expect(result).toEqual({ status: "authenticated" })
    expect(
      dependencies.userManagement.authenticateWithMagicAuth
    ).toHaveBeenCalledWith({
      clientId: "client_123",
      email: "person@example.com",
      code: "123456",
      ipAddress: "203.0.113.10",
      userAgent: "vitest",
    })
    expect(dependencies.saveSession).toHaveBeenCalledWith(
      authResponse,
      context.requestUrl
    )
    expect(dependencies.clearAuthFlow).toHaveBeenCalled()
  })

  it("maps invalid magic auth codes without exposing provider details", async () => {
    const dependencies = createDependencies()
    dependencies.userManagement.authenticateWithMagicAuth.mockRejectedValue({
      status: 422,
      message: "raw provider invalid code detail",
    })

    const result = await verifyMagicAuthCodeSession(
      { email: "person@example.com", code: "000000" },
      context,
      dependencies
    )

    expect(result).toEqual({
      status: "invalid-code",
      message: "Invalid verification code.",
    })
    expect(JSON.stringify(result)).not.toContain("raw provider")
  })

  it("saves a session after email verification succeeds", async () => {
    const dependencies = createDependencies()
    dependencies.getEmailVerificationFlow.mockResolvedValue({
      version: 1,
      kind: "email-verification",
      email: "person@example.com",
      pendingAuthenticationToken: "pending_token_123",
      expiresAt: Date.now() + 60_000,
    })
    dependencies.userManagement.authenticateWithEmailVerification.mockResolvedValue(
      authResponse
    )

    const result = await verifyEmailCodeSession(
      { code: "123456" },
      context,
      dependencies
    )

    expect(result).toEqual({ status: "verified" })
    expect(
      dependencies.userManagement.authenticateWithEmailVerification
    ).toHaveBeenCalledWith({
      clientId: "client_123",
      code: "123456",
      pendingAuthenticationToken: "pending_token_123",
      ipAddress: "203.0.113.10",
      userAgent: "vitest",
    })
    expect(dependencies.saveSession).toHaveBeenCalledWith(
      authResponse,
      context.requestUrl
    )
    expect(dependencies.clearAuthFlow).toHaveBeenCalled()
  })

  it("rejects email verification when the pending flow is missing", async () => {
    const dependencies = createDependencies()
    dependencies.getEmailVerificationFlow.mockResolvedValue(null)

    const result = await verifyEmailCodeSession(
      { code: "123456" },
      context,
      dependencies
    )

    expect(result.status).toBe("expired")
    expect(
      dependencies.userManagement.authenticateWithEmailVerification
    ).not.toHaveBeenCalled()
  })

  it("does not reveal whether a password reset email matched an account", async () => {
    const dependencies = createDependencies()
    dependencies.userManagement.createPasswordReset.mockRejectedValue({
      status: 404,
      message: "user not found",
    })

    await expect(
      requestPasswordResetEmail({ email: "missing@example.com" }, dependencies)
    ).resolves.toEqual({
      status: "sent",
      message:
        "If an account exists for that email, a reset link has been sent.",
    })
  })

  it("maps invalid reset tokens to a generic token error", async () => {
    const dependencies = createDependencies()
    dependencies.userManagement.resetPassword.mockRejectedValue({
      status: 422,
      message: "raw reset token detail",
    })

    await expect(
      resetPasswordWithToken(
        { token: "bad-token", password: "password123" },
        dependencies
      )
    ).resolves.toEqual({
      status: "invalid",
      message: "This reset link is invalid or expired.",
    })
  })
})
