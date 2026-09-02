/**
 * The short build identity stamped on run timing receipts (ADR-0030) so runs
 * group by the server build that produced them. Vercel injects the commit SHA
 * at runtime on every deployment; the Sentry release is the fallback whenever
 * that value is absent or unusable; local development resolves to undefined,
 * which is honest rather than a placeholder.
 */

const SHORT_SHA_LENGTH = 12
const FULL_SHA = /^[0-9a-f]{40}$/i
// Mirrors the Convex-side grammar in convex/lib/runTimingReceipt.ts; wide
// enough for a Sentry release such as `not-a-wrapper@1.2.3`.
const BUILD_ID = /^[A-Za-z0-9._@+-]{1,64}$/

function normalizeBuildId(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim()
  if (!trimmed) return undefined
  const candidate = FULL_SHA.test(trimmed)
    ? trimmed.slice(0, SHORT_SHA_LENGTH)
    : trimmed
  return BUILD_ID.test(candidate) ? candidate : undefined
}

export function resolveBuildId(
  env: Record<string, string | undefined> = process.env
): string | undefined {
  // First candidate that survives validation wins, so a present-but-unusable
  // Vercel value still falls through to the release.
  for (const raw of [env.VERCEL_GIT_COMMIT_SHA, env.SENTRY_RELEASE]) {
    const buildId = normalizeBuildId(raw)
    if (buildId) return buildId
  }
  return undefined
}
