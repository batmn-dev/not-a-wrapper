/**
 * The short build identity stamped on run timing receipts (ADR-0030) so runs
 * group by the server build that produced them. Vercel injects the commit SHA
 * at runtime on every deployment; the Sentry release is the fallback; local
 * development resolves to undefined, which is honest rather than a placeholder.
 */

const SHORT_SHA_LENGTH = 12
const FULL_SHA = /^[0-9a-f]{40}$/i
// Mirrors the Convex-side grammar in convex/lib/runTimingReceipt.ts; wide
// enough for a Sentry release such as `not-a-wrapper@1.2.3`.
const BUILD_ID = /^[A-Za-z0-9._@+-]{1,64}$/

export function resolveBuildId(
  env: Record<string, string | undefined> = process.env
): string | undefined {
  const raw = (env.VERCEL_GIT_COMMIT_SHA ?? env.SENTRY_RELEASE)?.trim()
  if (!raw) return undefined
  const candidate = FULL_SHA.test(raw) ? raw.slice(0, SHORT_SHA_LENGTH) : raw
  return BUILD_ID.test(candidate) ? candidate : undefined
}
