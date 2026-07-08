import { createHash, randomBytes, timingSafeEqual } from "crypto"
import { cookies } from "next/headers"

export const CSRF_COOKIE_NAME = "csrf_token"
export const CSRF_HEADER_NAME = "x-csrf-token"

function csrfSecret(): string {
  const secret = process.env.CSRF_SECRET
  if (!secret) throw new Error("CSRF_SECRET is required")
  return secret
}

function sign(raw: string): string {
  return createHash("sha256").update(`${raw}${csrfSecret()}`).digest("hex")
}

/** Constant-time string compare that never throws on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) return false
  return timingSafeEqual(aBuf, bBuf)
}

/**
 * Normalize a token to its decoded form before comparison.
 *
 * The double-submit's two copies of the token reach us through different
 * cookie-encoding boundaries: the server-side cookie is read via `next/headers`
 * `cookies()`, which URL-*decodes* it, while the client attaches the header by
 * reading `document.cookie`, which returns the raw URL-*encoded* value. Any token
 * character `encodeURIComponent` escapes — our `raw:sig` delimiter `:` becomes
 * `%3A` — makes the header (`…%3A…`) and cookie (`…:…`) diverge, so a legitimate
 * pair fails `safeEqual` and every state-changing request 403s. Decoding both to
 * the canonical form makes the check encoding-agnostic. Decoding is a no-op on an
 * already-decoded value (our tokens are hex + `:`, never a literal `%`), so this
 * is safe regardless of which side arrives encoded.
 */
function normalizeToken(token: string): string {
  try {
    return decodeURIComponent(token)
  } catch {
    // Malformed percent-encoding: keep the raw value and let the equality and
    // signature checks below reject it if it is a genuine mismatch.
    return token
  }
}

export function generateCsrfToken(): string {
  const raw = randomBytes(32).toString("hex")
  return `${raw}:${sign(raw)}`
}

/** Verify a token's signature (integrity) — not its binding to the cookie. */
export function validateCsrfToken(fullToken: string): boolean {
  const [raw, token] = fullToken.split(":")
  if (!raw || !token) return false
  return safeEqual(sign(raw), token)
}

/**
 * Full CSRF check for a state-changing request: the submitted header token must
 * be a validly-signed token AND must equal the cookie token (double-submit).
 *
 * Double-submit binds the request to a value only a same-origin caller can read
 * (SameSite=Lax keeps the cookie off cross-site requests); the signature stops a
 * network/subdomain attacker who can set a cookie from forging a matching pair.
 */
export function validateCsrfDoubleSubmit(
  headerToken: string | null | undefined,
  cookieToken: string | null | undefined
): boolean {
  if (!headerToken || !cookieToken) return false
  const header = normalizeToken(headerToken)
  const cookie = normalizeToken(cookieToken)
  if (!safeEqual(header, cookie)) return false
  return validateCsrfToken(header)
}

export async function setCsrfCookie() {
  const cookieStore = await cookies()
  const token = generateCsrfToken()
  cookieStore.set(CSRF_COOKIE_NAME, token, {
    // Readable by client JS so the double-submit header can be attached.
    httpOnly: false,
    secure: true,
    sameSite: "lax",
    path: "/",
  })
}
