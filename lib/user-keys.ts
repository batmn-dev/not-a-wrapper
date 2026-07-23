import { api } from "@/convex/_generated/api"
import { fetchQuery } from "convex/nextjs"
import { decryptSecret, isSupportedCiphertext } from "./encryption"
import { getProviderStrategy } from "./openproviders/provider-strategy"
import { Provider } from "./openproviders/types"
import { TOOL_PROVIDER_IDENTITY, type ToolProvider } from "./provider-identity"

export type { Provider } from "./openproviders/types"

export type ApiKeySource = "platform" | "byok"
export type ToolKeyMode = ApiKeySource

export type ProviderApiKeyResolution = {
  apiKey?: string
  source?: ApiKeySource
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
 * Check if user has a usable API key for a provider via Convex.
 * Rows in a pre-ADR-0010 ciphertext format can never decrypt, so they count
 * as absent — keeping this check consistent with getUserKeyFromConvex.
 */
export async function hasUserKey(
  provider: Provider,
  token?: string
): Promise<boolean> {
  if (!token) return false

  try {
    const userKey = await fetchQuery(
      api.userKeys.getByProvider,
      { provider },
      { token }
    )
    if (!userKey) return false
    if (!isSupportedCiphertext(userKey.encryptedKey ?? "")) {
      warnStaleCiphertextOnce(provider)
      return false
    }
    return true
  } catch (error) {
    console.error("Error checking user key:", error)
    return false
  }
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

    if (!userKey?.encryptedKey || !userKey?.iv) {
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
): Promise<ProviderApiKeyResolution> {
  // Try user key first if token is provided
  if (token) {
    const userKey = await getUserKeyFromConvex(provider, token)
    if (userKey) {
      return { apiKey: userKey, source: "byok" }
    }
  }

  // Fall back to the provider's platform env key. The env-var NAME is a static
  // provider-SDK fact owned by the provider strategy (the same fact the model
  // factory and the 401 preflight used to each restate); resolution stays here.
  const platformKey = process.env[getProviderStrategy(provider).envVarName]
  return platformKey
    ? { apiKey: platformKey, source: "platform" }
    : { apiKey: undefined, source: undefined }
}

/**
 * Backwards-compatible key-only accessor. New provider runtimes should prefer
 * `getEffectiveProviderApiKey` so they do not reconstruct credential provenance
 * from whether a key string happens to exist.
 */
export async function getEffectiveApiKey(
  provider: Provider,
  token?: string
): Promise<string | null> {
  return (await getEffectiveProviderApiKey(provider, token)).apiKey ?? null
}

/**
 * @deprecated Use hasUserKey or getUserKeyFromConvex instead
 */
export async function getUserKey(
  _userId: string,
  _provider: Provider
): Promise<string | null> {
  console.warn(
    "getUserKey is deprecated, use hasUserKey or getUserKeyFromConvex instead"
  )
  return null
}

// -----------------------------------------------------------------------
// Tool Provider Key Management
//
// Tool providers (Exa, Firecrawl) use the same encrypted key storage as
// AI providers (userKeys table in Convex). The `provider` field is
// already `v.string()` in the schema, so tool provider IDs are stored
// alongside AI provider IDs without schema changes. Their ids and static
// facts (including the platform env-var name) live in the Provider
// identity module; resolution stays here.
// -----------------------------------------------------------------------

export { TOOL_PROVIDER_IDS as TOOL_PROVIDERS } from "./provider-identity"
export type { ToolProvider } from "./provider-identity"

/**
 * Get the effective API key for a tool provider.
 * Uses the widened getUserKeyFromConvex (accepts string) for BYOK lookup,
 * then falls back to platform env vars.
 *
 * Resolution order:
 *   1. User BYOK key from Convex userKeys (encrypted, decrypted here)
 *   2. Platform env var (e.g., EXA_API_KEY)
 *   3. undefined (no key available → tool will be skipped)
 *
 * @param provider - The tool provider to get key for
 * @param convexToken - Optional Convex auth token for fetching user keys
 */
export async function getEffectiveToolKey(
  provider: ToolProvider,
  convexToken?: string
): Promise<string | undefined> {
  const resolved = await getEffectiveToolKeyWithMode(provider, convexToken)
  return resolved.key
}

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
