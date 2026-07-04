const REDACTED = "[REDACTED]"

const SENSITIVE_KEYS = new Set([
  "shippingaddress",
  "paymentmethod",
  "cardid",
  "credentials",
  "email",
  "phone",
  "line1",
  "line2",
  "postalcode",
  "address",
  "password",
  "secret",
  "token",
  "ssn",
])

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
const PHONE_RE = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase())
}

function scrubString(value: string): string {
  return value.replace(EMAIL_RE, REDACTED).replace(PHONE_RE, REDACTED)
}

function scrubValue(value: unknown, depth: number): unknown {
  if (depth > 20) return REDACTED
  if (value === null || value === undefined) return value
  if (typeof value === "string") return scrubString(value)
  if (typeof value === "number" || typeof value === "boolean") return value
  if (Array.isArray(value)) return scrubArray(value, depth)
  if (typeof value === "object")
    return scrubObject(value as Record<string, unknown>, depth)
  return REDACTED
}

function scrubArray(arr: unknown[], depth: number): unknown[] {
  return arr.map((item) => scrubValue(item, depth + 1))
}

function scrubObject(
  obj: Record<string, unknown>,
  depth: number
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(obj)) {
    if (isSensitiveKey(key)) {
      result[key] = REDACTED
    } else {
      result[key] = scrubValue(obj[key], depth + 1)
    }
  }
  return result
}

/**
 * Recursively scrub PII and sensitive fields from an arbitrary payload
 * before sending to PostHog analytics.
 *
 * - Redacts values under known-sensitive keys (case-insensitive).
 * - Replaces email/phone patterns in free text strings.
 * - Preserves structure, types, and coarse lengths for analytics utility.
 */
export function scrubForAnalytics<T>(value: T): T {
  return scrubValue(value, 0) as T
}
