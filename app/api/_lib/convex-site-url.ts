/**
 * Resolve the origin serving this deployment's Convex HTTP actions. Shared by
 * every server-side caller of a Convex HTTP route (durable worker wire,
 * profile-image proxy) so the resolution order lives in exactly one place.
 *
 * Kept free of `import "server-only"` so modules under test (which import this
 * directly) load in vitest's node environment.
 */
export function getConvexSiteUrl(): string {
  const explicit = process.env.CONVEX_SITE_URL
  if (explicit) return explicit

  const generated = process.env.NEXT_PUBLIC_CONVEX_SITE_URL
  if (generated) return generated

  const url = process.env.NEXT_PUBLIC_CONVEX_URL
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set")
  }

  // Hosted deployments serve HTTP actions from the .convex.site twin of the
  // .convex.cloud origin. Anything else (local `convex dev` on 127.0.0.1,
  // self-hosted origins) has no derivable twin — returning the input unchanged
  // would silently target the wrong service, so fail loud instead.
  const site = url.replace(/\.convex\.cloud$/, ".convex.site")
  if (site === url) {
    throw new Error(
      "Cannot derive the Convex site URL from NEXT_PUBLIC_CONVEX_URL " +
        `("${url}"); set CONVEX_SITE_URL or NEXT_PUBLIC_CONVEX_SITE_URL`
    )
  }
  return site
}
