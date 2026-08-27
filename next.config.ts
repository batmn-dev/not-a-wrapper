import { withSentryConfig } from "@sentry/nextjs"
import type { NextConfig } from "next"

const isProduction = process.env.NODE_ENV === "production"

/**
 * Derive the Convex deployment origins (https + wss) the browser talks to from
 * `NEXT_PUBLIC_CONVEX_URL`. The Convex client opens a WebSocket to the
 * deployment host and uploads/reads files over https on `*.convex.cloud`.
 * Falls back to the wildcard if the env var is absent at build time.
 */
function convexConnectSources(): string[] {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL
  if (!url) return ["https://*.convex.cloud", "wss://*.convex.cloud"]
  try {
    const { host } = new URL(url)
    return [
      `https://${host}`,
      `wss://${host}`,
      // File storage is served from sibling *.convex.cloud subdomains.
      "https://*.convex.cloud",
    ]
  } catch {
    return ["https://*.convex.cloud", "wss://*.convex.cloud"]
  }
}

/**
 * Content-Security-Policy. This is a baseline policy: the non-script directives
 * (`frame-ancestors`, `object-src`, `base-uri`, `form-action`, scoped
 * `connect-src`/`img-src`) are strict and carry real weight; `script-src` still
 * allows `'unsafe-inline'` because the App Router emits inline bootstrap scripts
 * and we have not adopted nonce injection yet (tracked as a follow-up). Sentry is
 * tunneled through the same-origin `/monitoring` route, so it needs no host here.
 */
function contentSecurityPolicy(): string {
  const convex = convexConnectSources()
  // PostHog loads its recorder/array scripts and ingests events from its own
  // subdomains; the exact region host is env-configured.
  const posthog = ["https://*.posthog.com"]

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "form-action": ["'self'"],
    "frame-src": ["'self'"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      // WASM (shiki / vscode-oniguruma highlighting) needs wasm compilation.
      "'wasm-unsafe-eval'",
      // React Fast Refresh / eval-based dev tooling only in development.
      ...(isProduction ? [] : ["'unsafe-eval'"]),
      ...posthog,
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    // Images are inert and can arrive from arbitrary hosts (markdown in model
    // responses, web-search source favicons/og-images), so allow any https
    // source — this still blocks mixed-content http: and non-image schemes.
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...convex, ...posthog],
  }

  const policy = Object.entries(directives)
    .map(([key, values]) => `${key} ${values.join(" ")}`)
    .join("; ")

  // Force TLS for any accidental http subresource in production.
  return isProduction ? `${policy}; upgrade-insecure-requests` : policy
}

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  // HSTS only in production — never pin localhost to https.
  ...(isProduction
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
]

const nextConfig: NextConfig = {
  // Default unchanged (.next). The chat-performance browser harness builds
  // into an isolated dir (NEXT_DIST_DIR=.next-perf) so a perf production
  // build/serve never touches the dev server's .next.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }]
  },
  experimental: {
    // Disables Turbopack's persistent SST cache to prevent recurring ENOENT crashes
    // from corrupted cache files. Trade-off: slightly slower cold starts (~5-15s).
    // TODO: Re-enable once upstream fix lands — https://github.com/vercel/next.js/issues
    // See: .agents/troubleshooting/turbopack-sst-write-failure.md
    turbopackFileSystemCacheForDev: false,
  },
  serverExternalPackages: ["shiki", "vscode-oniguruma"],
  images: {
    remotePatterns: [
      // Convex file storage
      {
        protocol: "https",
        hostname: "*.convex.cloud",
        port: "",
        pathname: "/**",
      },
      // GitHub avatars for user profiles
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
        port: "",
        pathname: "/**",
      },
      // Google favicon service (used by web search source citations)
      {
        protocol: "https",
        hostname: "www.google.com",
        port: "",
        pathname: "/s2/favicons/**",
      },
    ],
  },
}

export default withSentryConfig(nextConfig, {
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  silent: !process.env.CI,
  ...(process.env.SENTRY_ORG ? { org: process.env.SENTRY_ORG } : {}),
  ...(process.env.SENTRY_PROJECT
    ? { project: process.env.SENTRY_PROJECT }
    : {}),
})
