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

export function getAgentCredentials(): AgentCredentials {
  const password = process.env.PERF_AUTH_PASSWORD
  if (!password) {
    throw new Error(
      "PERF_AUTH_PASSWORD is not set — add it to the environment secrets to " +
        "authenticate agent sessions"
    )
  }
  return { email: process.env.PERF_AUTH_EMAIL ?? DEFAULT_AGENT_EMAIL, password }
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
  await page.goto(`${baseUrl}/auth/login`, {
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
