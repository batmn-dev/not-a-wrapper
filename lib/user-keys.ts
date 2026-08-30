import { api } from "@/convex/_generated/api"
import { fetchQuery } from "convex/nextjs"
import { decryptSecret, isSupportedCiphertext } from "./encryption"
import { getProviderStrategy } from "./openproviders/provider-strategy"
import { Provider } from "./openproviders/types"
import { TOOL_PROVIDER_IDENTITY, type ToolProvider } from "./provider-identity"

export type { Provider } from "./openproviders/types"

export type ApiKeySource = "platform" | "byok"
export type ToolKeyMode = ApiKeySource

export type ProviderCredentialResolution =
  | {
      provider: Provider
      apiKey: string
      source: ApiKeySource
    }
  | {
      provider: Provider
      apiKey?: undefined
      source?: undefined
    }

// Stale-format rows (written before the ADR-0010 AAD hardening) are a per-row
// constant, not a transient fault: they will fail on every request until the
// owner re-saves the key. Warn once per provider per process instead of
// emitting an error stack on every chat turn.
const staleCiphertextWarned = new Set<string>()

function warnStaleCiphertextOnce(provider: string) {
  if (staleCiphertextWarned.has(provider)) return
  staleCiphertextWarned.add(provider)
  console.warn(
    `Stored ${provider} API key predates the current encryption format and is ignored; re-save it in Settings.`
  )
}

/**
 * Get user's decrypted API key for a provider via Convex
 * Returns the decrypted key if found, null otherwise
 *
 * Accepts `string` (not just `Provider`) to support both AI providers
 * and tool providers (e.g., "exa", "firecrawl"). The Convex schema
 * already uses `v.string()` for the provider field.
 */
export async function getUserKeyFromConvex(
  provider: string, // Widened from Provider — supports AI providers and tool providers
  token?: string
): Promise<string | null> {
  if (!token) return null

  try {
    const userKey = await fetchQuery(
      api.userKeys.getByProvider,
      { provider },
      { token }
    )

    if (!userKey) {
      return null
    }

    if (!userKey.encryptedKey || !userKey.iv) {
      warnStaleCiphertextOnce(provider)
      return null
    }

    if (!isSupportedCiphertext(userKey.encryptedKey)) {
      warnStaleCiphertextOnce(provider)
      return null
    }

    return decryptSecret(userKey.encryptedKey, userKey.iv, {
      kind: "userKey",
      ownerId: userKey.ownerId,
      provider,
    })
  } catch (error) {
    console.error("Error fetching user key from Convex:", error)
    return null
  }
}

/**
 * Resolve the effective API key and its authoritative billing source.
 * User BYOK takes precedence over the platform environment key.
 */
export async function getEffectiveProviderApiKey(
  provider: Provider,
  token?: string
): Promise<ProviderCredentialResolution> {
  // Try user key first if token is provided
  if (token) {
    const userKey = await getUserKeyFromConvex(provider, token)
    if (userKey) {
      return { provider, apiKey: userKey, source: "byok" }
    }
  }

  // Fall back to the provider's platform env key. The env-var NAME is a static
  // provider-SDK fact owned by the provider strategy (the same fact the model
  // factory and the 401 preflight used to each restate); resolution stays here.
  const platformKey = process.env[getProviderStrategy(provider).envVarName]
  return platformKey
    ? { provider, apiKey: platformKey, source: "platform" }
    : { provider, apiKey: undefined, source: undefined }
}

// Tool Provider Key Management
//
// Tool providers (Exa, Firecrawl) use the same encrypted key storage as
// AI providers (userKeys table in Convex). The `provider` field is
// already `v.string()` in the schema, so tool provider IDs are stored
// alongside AI provider IDs without schema changes. Their ids and static
// facts (including the platform env-var name) live in the Provider
// identity module; resolution stays here.
export type { ToolProvider } from "./provider-identity"

/**
 * Resolve a tool provider key and where it came from.
 * Used by tool budget policy to apply platform-vs-BYOK limits.
 */
export async function getEffectiveToolKeyWithMode(
  provider: ToolProvider,
  convexToken?: string
): Promise<{ key?: string; keyMode?: ToolKeyMode }> {
  // 1. Try user BYOK key first (getUserKeyFromConvex accepts string)
  if (convexToken) {
    const userKey = await getUserKeyFromConvex(provider, convexToken)
    if (userKey) return { key: userKey, keyMode: "byok" }
  }

  // 2. Fall back to platform env var
  const platformKey =
    process.env[TOOL_PROVIDER_IDENTITY[provider].envVarName] || undefined
  if (platformKey) {
    return { key: platformKey, keyMode: "platform" }
  }
  return {}
}
