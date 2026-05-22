import "server-only"

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto"
import { cookies } from "next/headers"

const AUTH_FLOW_COOKIE = "naw-auth-flow"
const AUTH_FLOW_VERSION = 1
const AUTH_FLOW_TTL_SECONDS = 10 * 60

export type EmailVerificationFlow = {
  version: typeof AUTH_FLOW_VERSION
  kind: "email-verification"
  email: string
  pendingAuthenticationToken: string
  expiresAt: number
}

function getAuthFlowKey() {
  const cookiePassword = process.env.WORKOS_COOKIE_PASSWORD
  if (!cookiePassword || cookiePassword.length < 32) {
    throw new Error("WORKOS_COOKIE_PASSWORD must be at least 32 characters")
  }

  return createHash("sha256").update(cookiePassword).digest()
}

function toBase64Url(value: Buffer) {
  return value.toString("base64url")
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url")
}

export function createEmailVerificationFlow(
  email: string,
  pendingAuthenticationToken: string,
  now = Date.now()
): EmailVerificationFlow {
  return {
    version: AUTH_FLOW_VERSION,
    kind: "email-verification",
    email,
    pendingAuthenticationToken,
    expiresAt: now + AUTH_FLOW_TTL_SECONDS * 1000,
  }
}

export function sealAuthFlowCookieValue(flow: EmailVerificationFlow) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", getAuthFlowKey(), iv)
  const plaintext = Buffer.from(JSON.stringify(flow), "utf8")
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()

  return [toBase64Url(iv), toBase64Url(encrypted), toBase64Url(tag)].join(".")
}

export function openAuthFlowCookieValue(
  value: string | undefined,
  now = Date.now()
): EmailVerificationFlow | null {
  if (!value) return null

  try {
    const [ivValue, encryptedValue, tagValue] = value.split(".")
    if (!ivValue || !encryptedValue || !tagValue) return null

    const decipher = createDecipheriv(
      "aes-256-gcm",
      getAuthFlowKey(),
      fromBase64Url(ivValue)
    )
    decipher.setAuthTag(fromBase64Url(tagValue))

    const decrypted = Buffer.concat([
      decipher.update(fromBase64Url(encryptedValue)),
      decipher.final(),
    ])
    const parsed = JSON.parse(decrypted.toString("utf8")) as Partial<
      EmailVerificationFlow
    >

    if (
      parsed.version !== AUTH_FLOW_VERSION ||
      parsed.kind !== "email-verification" ||
      typeof parsed.email !== "string" ||
      typeof parsed.pendingAuthenticationToken !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= now
    ) {
      return null
    }

    return parsed as EmailVerificationFlow
  } catch {
    return null
  }
}

export async function setEmailVerificationFlowCookie(
  email: string,
  pendingAuthenticationToken: string
) {
  const cookieStore = await cookies()
  const value = sealAuthFlowCookieValue(
    createEmailVerificationFlow(email, pendingAuthenticationToken)
  )

  cookieStore.set(AUTH_FLOW_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: AUTH_FLOW_TTL_SECONDS,
    path: "/",
  })
}

export async function getEmailVerificationFlowCookie() {
  const cookieStore = await cookies()
  return openAuthFlowCookieValue(cookieStore.get(AUTH_FLOW_COOKIE)?.value)
}

export async function clearAuthFlowCookie() {
  const cookieStore = await cookies()
  cookieStore.set(AUTH_FLOW_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/",
  })
}
