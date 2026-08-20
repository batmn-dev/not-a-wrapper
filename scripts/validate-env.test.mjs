import { describe, expect, it } from "vitest"
import { validateEnvContent } from "./validate-env.mjs"

const validEncryptionKey = Buffer.alloc(32, 7).toString("base64")

function envContent(overrides = {}) {
  const env = {
    WORKOS_CLIENT_ID: "client_01TEST",
    WORKOS_API_KEY: "sk_test_01TEST",
    WORKOS_COOKIE_PASSWORD: "a".repeat(32),
    NEXT_PUBLIC_WORKOS_REDIRECT_URI: "http://localhost:3000/callback",
    CONVEX_DEPLOYMENT: "dev:test",
    NEXT_PUBLIC_CONVEX_URL: "https://test.convex.cloud",
    CSRF_SECRET: "csrf-secret",
    CHAT_ADMISSION_SECRET: "a".repeat(32),
    ENCRYPTION_KEY: validEncryptionKey,
    OPENAI_API_KEY: "sk-test",
    ...overrides,
  }

  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")
}

function validate(overrides = {}) {
  return validateEnvContent(envContent(overrides))
}

describe("validateEnvContent", () => {
  it("passes valid local env", () => {
    const result = validate()

    expect(result.errors).toEqual([])
  })

  it("fails when a required var is missing", () => {
    const result = validate({ WORKOS_CLIENT_ID: "" })

    expect(result.errors).toContain("WORKOS_CLIENT_ID is required in local env")
  })

  it("fails when WORKOS_COOKIE_PASSWORD is too short", () => {
    const result = validate({ WORKOS_COOKIE_PASSWORD: "short" })

    expect(result.errors).toContain(
      "WORKOS_COOKIE_PASSWORD must be at least 32 characters"
    )
  })

  it("fails when CHAT_ADMISSION_SECRET is too short", () => {
    const result = validate({ CHAT_ADMISSION_SECRET: "short" })

    expect(result.errors).toContain(
      "CHAT_ADMISSION_SECRET must be at least 32 bytes"
    )
  })

  it("fails when ENCRYPTION_KEY does not decode to 32 bytes", () => {
    const result = validate({
      ENCRYPTION_KEY: Buffer.alloc(16, 7).toString("base64"),
    })

    expect(result.errors).toContain(
      "ENCRYPTION_KEY must be base64 and decode to exactly 32 bytes"
    )
  })

  it("fails when redirect URI does not end with /callback", () => {
    const result = validate({
      NEXT_PUBLIC_WORKOS_REDIRECT_URI: "http://localhost:3000/auth/callbackish",
    })

    expect(result.errors).toContain(
      "NEXT_PUBLIC_WORKOS_REDIRECT_URI must end with /callback"
    )
  })

  it("fails when a secret is exposed through NEXT_PUBLIC_", () => {
    const result = validate({
      NEXT_PUBLIC_WORKOS_API_KEY: "sk_test_public_leak",
    })

    expect(result.errors).toContain(
      "NEXT_PUBLIC_WORKOS_API_KEY must not use NEXT_PUBLIC_; keep secrets server-side only"
    )
  })

  it("warns when WORKOS_WEBHOOK_SECRET is present locally", () => {
    const result = validate({
      WORKOS_WEBHOOK_SECRET: "whsec_local",
    })

    expect(result.warnings).toContain(
      "WORKOS_WEBHOOK_SECRET is present locally; the Convex deployment must also set it with bunx convex env set"
    )
  })

  it("warns when deploy keys are present locally", () => {
    const result = validate({
      CONVEX_DEPLOY_KEY: "deploy-key",
      CONVEX_SCHEMA_PREFLIGHT_DEPLOY_KEY: "query-key",
    })

    expect(result.warnings).toContain(
      "CONVEX_DEPLOY_KEY is Vercel-only and should not be needed locally"
    )
    expect(result.warnings).toContain(
      "CONVEX_SCHEMA_PREFLIGHT_DEPLOY_KEY is Vercel/GitHub deploy-only and should not be needed locally"
    )
  })

  it("warns when stale Clerk variables are present", () => {
    const result = validate({
      CLERK_JWT_ISSUER_DOMAIN: "legacy-clerk.example",
    })

    expect(result.warnings).toContain(
      "CLERK_JWT_ISSUER_DOMAIN is stale; this app uses WorkOS AuthKit"
    )
  })
})
