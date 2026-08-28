/**
 * Ensures the benchmark harness's WorkOS test user exists with a verified
 * email and a known password, using the WORKOS_API_KEY already present in
 * .env.local (bun auto-loads it). Idempotent: creates the user on first run,
 * verifies the password on later runs, and resets it if it drifted.
 *
 * The user lives in the SAME WorkOS environment as the app's dev client id,
 * so the harness's real /auth/login flow mints a genuine RS256 access token
 * that the Convex dev deployment accepts — the durable path runs for real.
 *
 * Override identity via PERF_AUTH_EMAIL. PERF_AUTH_PASSWORD is always
 * required so this real account never receives a source-controlled password.
 */
import { WorkOS } from "@workos-inc/node"

export const PERF_AUTH_EMAIL =
  process.env.PERF_AUTH_EMAIL ?? "chat-perf-harness@nawbench.dev"

export function getPerfAuthPassword(): string {
  const password = process.env.PERF_AUTH_PASSWORD
  if (!password) {
    throw new Error(
      "PERF_AUTH_PASSWORD missing from the environment — cannot provision " +
        "the harness test user"
    )
  }
  return password
}

export async function ensurePerfAuthUser(): Promise<void> {
  const password = getPerfAuthPassword()
  const apiKey = process.env.WORKOS_API_KEY
  const clientId = process.env.WORKOS_CLIENT_ID
  if (!apiKey || !clientId) {
    throw new Error(
      "WORKOS_API_KEY / WORKOS_CLIENT_ID missing from the environment " +
        "(.env.local) — cannot provision the harness test user"
    )
  }
  const workos = new WorkOS(apiKey)

  const existing = await workos.userManagement.listUsers({
    email: PERF_AUTH_EMAIL,
  })
  const user = existing.data[0]

  if (!user) {
    await workos.userManagement.createUser({
      email: PERF_AUTH_EMAIL,
      password,
      emailVerified: true,
      firstName: "Perf",
      lastName: "Harness",
    })
    console.log(`[ensure-auth-user] created ${PERF_AUTH_EMAIL}`)
    return
  }

  try {
    await workos.userManagement.authenticateWithPassword({
      clientId,
      email: PERF_AUTH_EMAIL,
      password,
    })
    console.log(`[ensure-auth-user] ${PERF_AUTH_EMAIL} ok (password verified)`)
  } catch {
    await workos.userManagement.updateUser({
      userId: user.id,
      password,
      emailVerified: true,
    })
    console.log(`[ensure-auth-user] reset password for ${PERF_AUTH_EMAIL}`)
  }
}

if (import.meta.main) {
  ensurePerfAuthUser().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
