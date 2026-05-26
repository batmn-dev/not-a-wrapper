"use server"

import { APP_DOMAIN } from "@/lib/config"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import {
  fieldErrorsFromZodError,
  forgotPasswordSchema,
  loginSchema,
  magicAuthStartSchema,
  magicAuthVerifySchema,
  resetPasswordSchema,
  signUpSchema,
  verifyEmailSchema,
  type AuthActionState,
} from "./_lib/schemas"
import {
  requestPasswordResetEmail,
  resetPasswordWithToken,
  signInWithPasswordSession,
  signUpWithPasswordSession,
  startMagicAuthSession,
  verifyEmailCodeSession,
  verifyMagicAuthCodeSession,
} from "./_lib/workos-password-auth"

function formDataToObject(formData: FormData) {
  return Object.fromEntries(formData.entries())
}

function firstHeaderValue(value: string | null) {
  return value?.split(",")[0]?.trim() || undefined
}

async function getRequestContext(pathname: string) {
  const headerStore = await headers()
  const host =
    firstHeaderValue(headerStore.get("x-forwarded-host")) ??
    headerStore.get("host") ??
    new URL(APP_DOMAIN).host
  const protocol =
    firstHeaderValue(headerStore.get("x-forwarded-proto")) ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https")
  // SECURITY: This trusts proxy IP headers because Vercel is the only
  // deployment target and rewrites them at the edge. If Vercel is not the only
  // deployment target, flag this and replace it with an explicit trusted-proxy
  // client IP resolver or omit ipAddress before shipping auth changes.
  const ipAddress =
    headerStore.get("x-real-ip") ??
    firstHeaderValue(headerStore.get("x-forwarded-for"))

  return {
    requestUrl: `${protocol}://${host}${pathname}`,
    ipAddress,
    userAgent: headerStore.get("user-agent") ?? undefined,
  }
}

function authError(message: string): AuthActionState {
  return { status: "error", message }
}

function authenticated(redirectTo = "/"): AuthActionState {
  return { status: "authenticated", redirectTo }
}

export async function signInWithPassword(
  _previousState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const parsed = loginSchema.safeParse(formDataToObject(formData))
  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: fieldErrorsFromZodError(parsed.error),
    }
  }

  const result = await signInWithPasswordSession(
    parsed.data,
    await getRequestContext("/auth/login")
  )

  if (result.status === "authenticated") {
    return authenticated()
  }

  if (result.status === "email-verification-required") {
    redirect(`/auth/verify-email?email=${encodeURIComponent(result.email)}`)
  }

  return authError(result.message)
}

export async function signUpWithPassword(
  _previousState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const parsed = signUpSchema.safeParse(formDataToObject(formData))
  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: fieldErrorsFromZodError(parsed.error),
    }
  }

  const result = await signUpWithPasswordSession(
    parsed.data,
    await getRequestContext("/auth/sign-up")
  )

  if (result.status === "authenticated") {
    return authenticated()
  }

  if (result.status === "email-verification-required") {
    redirect(`/auth/verify-email?email=${encodeURIComponent(result.email)}`)
  }

  return authError(result.message)
}

export async function requestMagicAuthCode(
  _previousState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const parsed = magicAuthStartSchema.safeParse(formDataToObject(formData))
  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: fieldErrorsFromZodError(parsed.error),
    }
  }

  const result = await startMagicAuthSession(parsed.data)

  if (result.status === "sent") {
    redirect(
      `/email-verification?email=${encodeURIComponent(parsed.data.email)}`
    )
  }

  if (result.status === "unavailable") {
    redirect(
      `/auth/login?email=${encodeURIComponent(parsed.data.email)}&magic=unavailable`
    )
  }

  return authError(result.message)
}

export async function resendMagicAuthCode(
  _previousState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const parsed = magicAuthStartSchema.safeParse(formDataToObject(formData))
  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: fieldErrorsFromZodError(parsed.error),
    }
  }

  const result = await startMagicAuthSession(parsed.data)

  if (result.status === "sent") {
    return { status: "success", message: "We sent a new code." }
  }

  return authError(result.message)
}

export async function verifyMagicAuthCode(
  _previousState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const parsed = magicAuthVerifySchema.safeParse(formDataToObject(formData))
  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: fieldErrorsFromZodError(parsed.error),
    }
  }

  const result = await verifyMagicAuthCodeSession(
    parsed.data,
    await getRequestContext("/email-verification")
  )

  if (result.status === "authenticated") {
    return authenticated()
  }

  if (result.status === "invalid-code") {
    return {
      status: "error",
      fieldErrors: { code: result.message },
    }
  }

  return authError(result.message)
}

export async function verifyEmailCode(
  _previousState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const parsed = verifyEmailSchema.safeParse(formDataToObject(formData))
  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: fieldErrorsFromZodError(parsed.error),
    }
  }

  const result = await verifyEmailCodeSession(
    parsed.data,
    await getRequestContext("/auth/verify-email")
  )

  if (result.status === "verified") {
    return authenticated()
  }

  if (result.status === "invalid-code") {
    return {
      status: "error",
      fieldErrors: { code: result.message },
    }
  }

  return authError(result.message)
}

export async function requestPasswordReset(
  _previousState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const parsed = forgotPasswordSchema.safeParse(formDataToObject(formData))
  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: fieldErrorsFromZodError(parsed.error),
    }
  }

  const result = await requestPasswordResetEmail(parsed.data)
  return {
    status: result.status === "sent" ? "success" : "error",
    message: result.message,
  }
}

export async function resetPassword(
  _previousState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const parsed = resetPasswordSchema.safeParse(formDataToObject(formData))
  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: fieldErrorsFromZodError(parsed.error),
    }
  }

  const result = await resetPasswordWithToken({
    token: parsed.data.token,
    password: parsed.data.password,
  })

  if (result.status === "reset") {
    redirect("/auth/login?reset=complete")
  }

  if (result.status === "invalid") {
    return {
      status: "error",
      fieldErrors: { token: result.message },
    }
  }

  return authError(result.message)
}
