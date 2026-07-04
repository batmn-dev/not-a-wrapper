import "server-only"
import { getWorkOS, saveSession } from "@workos-inc/authkit-nextjs"
import type { AuthenticationResponse } from "@workos-inc/node"
import {
  clearAuthFlowCookie,
  getEmailVerificationFlowCookie,
  setEmailVerificationFlowCookie,
  type EmailVerificationFlow,
} from "./auth-flow-cookie"
import { splitFullName } from "./schemas"

const INVALID_CREDENTIALS_MESSAGE = "Invalid email or password."
const GENERIC_AUTH_MESSAGE = "Something went wrong. Try again."
const MAGIC_AUTH_UNAVAILABLE_MESSAGE =
  "Email code sign-in is not enabled yet. Continue with password instead."
const RATE_LIMIT_MESSAGE = "Too many attempts. Try again later."
const UNSUPPORTED_AUTH_MESSAGE =
  "This account requires an authentication method that is not available on this page yet."
const RESET_SENT_MESSAGE =
  "If an account exists for that email, a reset link has been sent."

type RequestContext = {
  requestUrl: string
  ipAddress?: string
  userAgent?: string
}

type WorkosUserManagement = {
  authenticateWithMagicAuth: (input: {
    clientId: string
    email: string
    code: string
    ipAddress?: string
    userAgent?: string
  }) => Promise<AuthenticationResponse>
  authenticateWithPassword: (input: {
    clientId: string
    email: string
    password: string
    ipAddress?: string
    userAgent?: string
  }) => Promise<AuthenticationResponse>
  authenticateWithEmailVerification: (input: {
    clientId: string
    code: string
    pendingAuthenticationToken: string
    ipAddress?: string
    userAgent?: string
  }) => Promise<AuthenticationResponse>
  createUser: (input: {
    email: string
    password: string
    firstName?: string
    lastName?: string
  }) => Promise<{ id: string }>
  createMagicAuth: (input: { email: string }) => Promise<unknown>
  createPasswordReset: (input: { email: string }) => Promise<unknown>
  resetPassword: (input: {
    token: string
    newPassword: string
  }) => Promise<unknown>
}

export type WorkosAuthDependencies = {
  clientId: string
  userManagement: WorkosUserManagement
  saveSession: (
    session: AuthenticationResponse,
    requestUrl: string
  ) => Promise<void>
  setEmailVerificationFlow: (
    email: string,
    pendingAuthenticationToken: string
  ) => Promise<void>
  getEmailVerificationFlow: () => Promise<EmailVerificationFlow | null>
  clearAuthFlow: () => Promise<void>
}

export type PasswordAuthResult =
  | { status: "authenticated" }
  | { status: "email-verification-required"; email: string }
  | { status: "invalid-credentials"; message: string }
  | { status: "unsupported"; message: string }
  | { status: "rate-limited"; message: string }
  | { status: "error"; message: string }

export type PasswordResetRequestResult =
  | { status: "sent"; message: string }
  | { status: "rate-limited"; message: string }

export type MagicAuthStartResult =
  | { status: "sent" }
  | { status: "unavailable"; message: string }
  | { status: "rate-limited"; message: string }
  | { status: "error"; message: string }

export type MagicAuthVerifyResult =
  | { status: "authenticated" }
  | { status: "invalid-code"; message: string }
  | { status: "rate-limited"; message: string }
  | { status: "unsupported"; message: string }
  | { status: "error"; message: string }

export type ResetPasswordResult =
  | { status: "reset" }
  | { status: "invalid"; message: string }
  | { status: "rate-limited"; message: string }
  | { status: "error"; message: string }

export type EmailVerificationResult =
  | { status: "verified" }
  | { status: "expired"; message: string }
  | { status: "invalid-code"; message: string }
  | { status: "rate-limited"; message: string }
  | { status: "unsupported"; message: string }
  | { status: "error"; message: string }

export function getDefaultWorkosAuthDependencies(): WorkosAuthDependencies {
  const clientId = process.env.WORKOS_CLIENT_ID
  if (!clientId) {
    throw new Error("WORKOS_CLIENT_ID is required")
  }

  return {
    clientId,
    userManagement: getWorkOS().userManagement,
    saveSession,
    setEmailVerificationFlow: setEmailVerificationFlowCookie,
    getEmailVerificationFlow: getEmailVerificationFlowCookie,
    clearAuthFlow: clearAuthFlowCookie,
  }
}

function getErrorStatus(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    return error.status
  }

  return null
}

function getAuthenticationErrorCode(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code
  }

  return null
}

function getErrorMessage(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message
  }

  return null
}

function getPendingAuthenticationToken(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "pendingAuthenticationToken" in error &&
    typeof error.pendingAuthenticationToken === "string"
  ) {
    return error.pendingAuthenticationToken
  }

  return null
}

function isInvalidCredentialStatus(status: number | null) {
  return status === 400 || status === 401 || status === 404
}

function isRateLimitedStatus(status: number | null) {
  return status === 429
}

function isMagicAuthUnavailableError(error: unknown) {
  return (
    getErrorStatus(error) === 400 &&
    getErrorMessage(error)?.toLowerCase().includes("magic auth is disabled")
  )
}

function isUnsupportedAuthCode(code: string | null) {
  return (
    code === "mfa_enrollment" ||
    code === "mfa_challenge" ||
    code === "mfa_verification" ||
    code === "organization_selection_required" ||
    code === "sso_required"
  )
}

function mapPasswordAuthError(
  error: unknown,
  email: string
): Exclude<PasswordAuthResult, { status: "authenticated" }> {
  const code = getAuthenticationErrorCode(error)
  const pendingAuthenticationToken = getPendingAuthenticationToken(error)
  const status = getErrorStatus(error)

  if (code === "email_verification_required" && pendingAuthenticationToken) {
    return { status: "email-verification-required", email }
  }

  if (isUnsupportedAuthCode(code)) {
    return { status: "unsupported", message: UNSUPPORTED_AUTH_MESSAGE }
  }

  if (isRateLimitedStatus(status)) {
    return { status: "rate-limited", message: RATE_LIMIT_MESSAGE }
  }

  if (isInvalidCredentialStatus(status)) {
    return {
      status: "invalid-credentials",
      message: INVALID_CREDENTIALS_MESSAGE,
    }
  }

  return { status: "error", message: GENERIC_AUTH_MESSAGE }
}

async function authenticateAndSavePasswordSession(
  input: { email: string; password: string },
  context: RequestContext,
  dependencies: WorkosAuthDependencies
): Promise<PasswordAuthResult> {
  try {
    const authResponse =
      await dependencies.userManagement.authenticateWithPassword({
        clientId: dependencies.clientId,
        email: input.email,
        password: input.password,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      })

    await dependencies.saveSession(authResponse, context.requestUrl)
    await dependencies.clearAuthFlow()
    return { status: "authenticated" }
  } catch (error) {
    const result = mapPasswordAuthError(error, input.email)

    if (result.status === "email-verification-required") {
      const pendingAuthenticationToken = getPendingAuthenticationToken(error)
      if (!pendingAuthenticationToken) {
        return { status: "error", message: GENERIC_AUTH_MESSAGE }
      }

      await dependencies.setEmailVerificationFlow(
        input.email,
        pendingAuthenticationToken
      )
    }

    return result
  }
}

export async function signInWithPasswordSession(
  input: { email: string; password: string },
  context: RequestContext,
  dependencies = getDefaultWorkosAuthDependencies()
) {
  return authenticateAndSavePasswordSession(input, context, dependencies)
}

export async function signUpWithPasswordSession(
  input: { name: string; email: string; password: string },
  context: RequestContext,
  dependencies = getDefaultWorkosAuthDependencies()
): Promise<PasswordAuthResult> {
  try {
    const { firstName, lastName } = splitFullName(input.name)

    await dependencies.userManagement.createUser({
      email: input.email,
      password: input.password,
      firstName,
      lastName,
    })
  } catch (error) {
    const status = getErrorStatus(error)

    if (isRateLimitedStatus(status)) {
      return { status: "rate-limited", message: RATE_LIMIT_MESSAGE }
    }

    return { status: "error", message: GENERIC_AUTH_MESSAGE }
  }

  return authenticateAndSavePasswordSession(input, context, dependencies)
}

export async function startMagicAuthSession(
  input: { email: string },
  dependencies = getDefaultWorkosAuthDependencies()
): Promise<MagicAuthStartResult> {
  try {
    await dependencies.userManagement.createMagicAuth({ email: input.email })
    await dependencies.clearAuthFlow()
    return { status: "sent" }
  } catch (error) {
    if (isMagicAuthUnavailableError(error)) {
      return {
        status: "unavailable",
        message: MAGIC_AUTH_UNAVAILABLE_MESSAGE,
      }
    }

    if (isRateLimitedStatus(getErrorStatus(error))) {
      return { status: "rate-limited", message: RATE_LIMIT_MESSAGE }
    }

    return { status: "error", message: GENERIC_AUTH_MESSAGE }
  }
}

export async function verifyMagicAuthCodeSession(
  input: { email: string; code: string },
  context: RequestContext,
  dependencies = getDefaultWorkosAuthDependencies()
): Promise<MagicAuthVerifyResult> {
  try {
    const authResponse =
      await dependencies.userManagement.authenticateWithMagicAuth({
        clientId: dependencies.clientId,
        email: input.email,
        code: input.code,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      })

    await dependencies.saveSession(authResponse, context.requestUrl)
    await dependencies.clearAuthFlow()
    return { status: "authenticated" }
  } catch (error) {
    const code = getAuthenticationErrorCode(error)
    const status = getErrorStatus(error)

    if (isUnsupportedAuthCode(code)) {
      return { status: "unsupported", message: UNSUPPORTED_AUTH_MESSAGE }
    }

    if (isRateLimitedStatus(status)) {
      return { status: "rate-limited", message: RATE_LIMIT_MESSAGE }
    }

    if (isInvalidCredentialStatus(status) || status === 422) {
      return { status: "invalid-code", message: "Invalid verification code." }
    }

    return { status: "error", message: GENERIC_AUTH_MESSAGE }
  }
}

export async function verifyEmailCodeSession(
  input: { code: string },
  context: RequestContext,
  dependencies = getDefaultWorkosAuthDependencies()
): Promise<EmailVerificationResult> {
  const flow = await dependencies.getEmailVerificationFlow()
  if (!flow) {
    return {
      status: "expired",
      message: "That verification session expired. Sign in again.",
    }
  }

  try {
    const authResponse =
      await dependencies.userManagement.authenticateWithEmailVerification({
        clientId: dependencies.clientId,
        code: input.code,
        pendingAuthenticationToken: flow.pendingAuthenticationToken,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      })

    await dependencies.saveSession(authResponse, context.requestUrl)
    await dependencies.clearAuthFlow()
    return { status: "verified" }
  } catch (error) {
    const code = getAuthenticationErrorCode(error)
    const status = getErrorStatus(error)

    if (isUnsupportedAuthCode(code)) {
      return { status: "unsupported", message: UNSUPPORTED_AUTH_MESSAGE }
    }

    if (isRateLimitedStatus(status)) {
      return { status: "rate-limited", message: RATE_LIMIT_MESSAGE }
    }

    if (isInvalidCredentialStatus(status) || status === 422) {
      return { status: "invalid-code", message: "Invalid verification code." }
    }

    return { status: "error", message: GENERIC_AUTH_MESSAGE }
  }
}

export async function requestPasswordResetEmail(
  input: { email: string },
  dependencies = getDefaultWorkosAuthDependencies()
): Promise<PasswordResetRequestResult> {
  try {
    await dependencies.userManagement.createPasswordReset({
      email: input.email,
    })
  } catch (error) {
    if (isRateLimitedStatus(getErrorStatus(error))) {
      return { status: "rate-limited", message: RATE_LIMIT_MESSAGE }
    }
  }

  return { status: "sent", message: RESET_SENT_MESSAGE }
}

export async function resetPasswordWithToken(
  input: { token: string; password: string },
  dependencies = getDefaultWorkosAuthDependencies()
): Promise<ResetPasswordResult> {
  try {
    await dependencies.userManagement.resetPassword({
      token: input.token,
      newPassword: input.password,
    })

    await dependencies.clearAuthFlow()
    return { status: "reset" }
  } catch (error) {
    const status = getErrorStatus(error)

    if (isRateLimitedStatus(status)) {
      return { status: "rate-limited", message: RATE_LIMIT_MESSAGE }
    }

    if (isInvalidCredentialStatus(status) || status === 422 || status === 403) {
      return {
        status: "invalid",
        message: "This reset link is invalid or expired.",
      }
    }

    return { status: "error", message: GENERIC_AUTH_MESSAGE }
  }
}
