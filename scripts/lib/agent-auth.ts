/**
 * Shared WorkOS email/password login for agent tooling.
 *
 * The app's WorkOS environment requires email verification, so the human flow
 * involves an email code. Agents skip that by using a test user provisioned
 * with `emailVerified: true` (see benchmarks/.../ensure-auth-user.ts), then
 * signing in with password — no code. Credentials come only from the
 * environment; the password is never hard-coded.
 */
import type { Page } from "playwright"

export type AgentCredentials = { email: string; password: string }

export const DEFAULT_AGENT_EMAIL = "chat-perf-harness@nawbench.dev"

/** WorkOS password policy minimum. */
export const MIN_AGENT_PASSWORD_LENGTH = 10

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])

export function getAgentCredentials(): AgentCredentials {
  const password = process.env.PERF_AUTH_PASSWORD
  if (!password) {
    throw new Error(
      "PERF_AUTH_PASSWORD is not set — add it to the environment secrets to " +
        "authenticate agent sessions"
    )
  }
  if (password.length < MIN_AGENT_PASSWORD_LENGTH) {
    throw new Error(
      `PERF_AUTH_PASSWORD must be at least ${MIN_AGENT_PASSWORD_LENGTH} ` +
        "characters (WorkOS policy)"
    )
  }
  return { email: process.env.PERF_AUTH_EMAIL ?? DEFAULT_AGENT_EMAIL, password }
}

/**
 * Origin used for `/auth/login`. Loopback may be http or https. Any other
 * host must be https and explicitly allowlisted via `AGENT_AUTH_ORIGIN`
 * (or the https origin of `NEXT_PUBLIC_WORKOS_REDIRECT_URI`) so a caller
 * cannot point `--base-url` / `--url` at an untrusted page and harvest
 * `PERF_AUTH_PASSWORD`.
 */
export function assertSafeAuthOrigin(baseUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new Error(`Invalid authentication URL: ${baseUrl}`)
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Authentication URL must be http or https (got ${parsed.protocol})`
    )
  }

  if (LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
    return parsed.origin
  }

  if (parsed.protocol !== "https:") {
    throw new Error(
      `Refusing to send credentials to non-loopback http origin ${parsed.origin}. ` +
        "Use https or localhost."
    )
  }

  if (!allowedRemoteOrigins().has(parsed.origin)) {
    throw new Error(
      `Refusing to send credentials to ${parsed.origin}. ` +
        `Set AGENT_AUTH_ORIGIN=${parsed.origin} to allow this https origin.`
    )
  }

  return parsed.origin
}

function allowedRemoteOrigins(): Set<string> {
  const origins = new Set<string>()
  for (const raw of [
    process.env.AGENT_AUTH_ORIGIN,
    process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI,
  ]) {
    if (!raw) continue
    try {
      const url = new URL(raw)
      if (url.protocol === "https:") origins.add(url.origin)
    } catch {
      // Ignore malformed allowlist entries.
    }
  }
  return origins
}

/**
 * Signs the page in through the real /auth/login form and resolves once the
 * authenticated app has loaded (redirected away from /auth, composer visible).
 * Throws if the login does not complete.
 */
export async function signInWithPassword(
  page: Page,
  baseUrl: string,
  credentials: AgentCredentials = getAgentCredentials()
): Promise<void> {
  const origin = assertSafeAuthOrigin(baseUrl)
  await page.goto(`${origin}/auth/login`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  })
  await page.locator("#email").fill(credentials.email)
  await page.locator("#password").fill(credentials.password)
  await page.locator("#password").press("Enter")
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), {
    timeout: 30_000,
  })
  await page
    .locator('[contenteditable="true"]')
    .first()
    .waitFor({ state: "visible", timeout: 20_000 })
}
