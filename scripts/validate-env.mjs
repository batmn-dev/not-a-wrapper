#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

export const AI_PROVIDER_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "MISTRAL_API_KEY",
  "PERPLEXITY_API_KEY",
  "XAI_API_KEY",
  "OPENROUTER_API_KEY",
]

const REQUIRED_LOCAL_VARS = [
  "WORKOS_CLIENT_ID",
  "WORKOS_API_KEY",
  "WORKOS_COOKIE_PASSWORD",
  "NEXT_PUBLIC_WORKOS_REDIRECT_URI",
  "CONVEX_DEPLOYMENT",
  "NEXT_PUBLIC_CONVEX_URL",
  "CSRF_SECRET",
  "ENCRYPTION_KEY",
]

const ALLOWED_PUBLIC_SECRET_LIKE_KEYS = new Set([
  "NEXT_PUBLIC_CONVEX_URL",
  "NEXT_PUBLIC_POSTHOG_HOST",
  "NEXT_PUBLIC_POSTHOG_KEY",
  "NEXT_PUBLIC_SENTRY_DSN",
  "NEXT_PUBLIC_VERCEL_URL",
  "NEXT_PUBLIC_WORKOS_REDIRECT_URI",
])

function parseEnvValue(rawValue) {
  const value = rawValue.trim()
  if (!value) return ""

  const quote = value[0]
  if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
    return value.slice(1, -1)
  }

  return value.replace(/\s+#.*$/, "").trim()
}

export function parseEnvContent(content) {
  const env = {}
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/)

  for (const line of lines) {
    let trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    if (trimmed.startsWith("export ")) {
      trimmed = trimmed.slice("export ".length).trim()
    }

    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed)
    if (!match) continue

    env[match[1]] = parseEnvValue(match[2] ?? "")
  }

  return env
}

function hasValue(env, key) {
  return typeof env[key] === "string" && env[key].trim().length > 0
}

function isLocalhostUrl(value) {
  try {
    const url = new URL(value)
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
  } catch {
    return false
  }
}

function isValidBase64(value) {
  const normalized = value.trim()
  if (!normalized || normalized.length % 4 === 1) return false
  return /^[A-Za-z0-9+/]+={0,2}$/.test(normalized)
}

function decodedBase64Length(value) {
  if (!isValidBase64(value)) return null
  return Buffer.from(value, "base64").length
}

function isPublicSecretKey(key) {
  if (!key.startsWith("NEXT_PUBLIC_")) return false
  if (ALLOWED_PUBLIC_SECRET_LIKE_KEYS.has(key)) return false

  return /(?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE|DEPLOY_KEY|COOKIE|WEBHOOK|ENCRYPTION_KEY)/.test(
    key
  )
}

export function validateEnvContent(content, options = {}) {
  const env = parseEnvContent(content)
  const errors = []
  const warnings = []
  const allowNonLocalRedirect =
    options.allowNonLocalRedirect === true ||
    env.ALLOW_NON_LOCAL_WORKOS_REDIRECT_URI === "1" ||
    process.env.ALLOW_NON_LOCAL_WORKOS_REDIRECT_URI === "1"

  for (const key of REQUIRED_LOCAL_VARS) {
    if (!hasValue(env, key)) {
      errors.push(`${key} is required in local env`)
    }
  }

  if (!AI_PROVIDER_KEYS.some((key) => hasValue(env, key))) {
    errors.push(
      `At least one AI provider key is required: ${AI_PROVIDER_KEYS.join(", ")}`
    )
  }

  if (
    hasValue(env, "WORKOS_COOKIE_PASSWORD") &&
    env.WORKOS_COOKIE_PASSWORD.length < 32
  ) {
    errors.push("WORKOS_COOKIE_PASSWORD must be at least 32 characters")
  }

  if (hasValue(env, "NEXT_PUBLIC_WORKOS_REDIRECT_URI")) {
    let redirectUrl = null
    try {
      redirectUrl = new URL(env.NEXT_PUBLIC_WORKOS_REDIRECT_URI)
    } catch {
      errors.push(
        "NEXT_PUBLIC_WORKOS_REDIRECT_URI must be a valid absolute URL"
      )
    }

    if (redirectUrl) {
      if (!redirectUrl.pathname.endsWith("/callback")) {
        errors.push("NEXT_PUBLIC_WORKOS_REDIRECT_URI must end with /callback")
      }

      if (
        !allowNonLocalRedirect &&
        !isLocalhostUrl(env.NEXT_PUBLIC_WORKOS_REDIRECT_URI)
      ) {
        errors.push(
          "NEXT_PUBLIC_WORKOS_REDIRECT_URI must be localhost for local env; set ALLOW_NON_LOCAL_WORKOS_REDIRECT_URI=1 to override"
        )
      }
    }
  }

  if (
    hasValue(env, "NEXT_PUBLIC_CONVEX_URL") &&
    !env.NEXT_PUBLIC_CONVEX_URL.startsWith("https://")
  ) {
    errors.push("NEXT_PUBLIC_CONVEX_URL must start with https://")
  }

  if (hasValue(env, "ENCRYPTION_KEY")) {
    const decodedLength = decodedBase64Length(env.ENCRYPTION_KEY)
    if (decodedLength !== 32) {
      errors.push(
        "ENCRYPTION_KEY must be base64 and decode to exactly 32 bytes"
      )
    }
  }

  for (const key of Object.keys(env)) {
    if (isPublicSecretKey(key)) {
      errors.push(
        `${key} must not use NEXT_PUBLIC_; keep secrets server-side only`
      )
    }

    if (key.startsWith("CLERK_")) {
      warnings.push(`${key} is stale; this app uses WorkOS AuthKit`)
    }
  }

  if (hasValue(env, "WORKOS_WEBHOOK_SECRET")) {
    warnings.push(
      "WORKOS_WEBHOOK_SECRET is present locally; the Convex deployment must also set it with bunx convex env set"
    )
  }

  if (hasValue(env, "WORKOS_ACTION_SECRET")) {
    warnings.push(
      "WORKOS_ACTION_SECRET belongs in Convex env only if WorkOS actions are used"
    )
  }

  if (hasValue(env, "CONVEX_DEPLOY_KEY")) {
    warnings.push(
      "CONVEX_DEPLOY_KEY is Vercel-only and should not be needed locally"
    )
  }

  return { env, errors, warnings }
}

export function validateEnvFile(filePath, options = {}) {
  const resolvedPath = resolve(filePath)

  if (!existsSync(resolvedPath)) {
    return {
      env: {},
      errors: [`${filePath} does not exist`],
      warnings: [],
    }
  }

  return validateEnvContent(readFileSync(resolvedPath, "utf8"), options)
}

function runCli() {
  const args = process.argv.slice(2)
  const allowNonLocalRedirect = args.includes("--allow-non-local-redirect")
  const envFilePath = args.find((arg) => !arg.startsWith("--")) ?? ".env.local"
  const result = validateEnvFile(envFilePath, { allowNonLocalRedirect })

  if (result.warnings.length > 0) {
    console.warn(`Env validation warnings for ${envFilePath}:`)
    for (const warning of result.warnings) {
      console.warn(`WARN ${warning}`)
    }
  }

  if (result.errors.length > 0) {
    console.error(`Env validation failed for ${envFilePath}:`)
    for (const error of result.errors) {
      console.error(`ERROR ${error}`)
    }
    process.exitCode = 1
    return
  }

  console.log(`OK ${envFilePath} passed env validation`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli()
}
