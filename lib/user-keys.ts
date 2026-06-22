import { fetchQuery } from "convex/nextjs"
import { api } from "@/convex/_generated/api"
import { decryptKey } from "./encryption"
import { getProviderStrategy } from "./openproviders/provider-strategy"
import { Provider } from "./openproviders/types"

export type { Provider } from "./openproviders/types"

/**
 * Check if user has an API key for a provider via Convex
 * Returns true if a key exists, false otherwise
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
    return userKey !== null
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

    return decryptKey(userKey.encryptedKey, userKey.iv)
  } catch (error) {
    console.error("Error fetching user key from Convex:", error)
    return null
  }
}

/**
 * Get the effective API key for a provider
 * Checks user's key first (via Convex), then falls back to environment variable
 *
 * @param provider - The AI provider to get key for
 * @param token - Optional Convex auth token for fetching user keys
 */
export async function getEffectiveApiKey(
  provider: Provider,
  token?: string
): Promise<string | null> {
  // Try user key first if token is provided
  if (token) {
    const userKey = await getUserKeyFromConvex(provider, token)
    if (userKey) {
      return userKey
    }
  }

  // Fall back to the provider's platform env key. The env-var NAME is a static
  // provider-SDK fact owned by the provider strategy (the same fact the model
  // factory and the 401 preflight used to each restate); resolution stays here.
  return process.env[getProviderStrategy(provider).envVarName] || null
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
// alongside AI provider IDs without schema changes.
// -----------------------------------------------------------------------

/** Tool provider IDs that can be stored in userKeys */
export const TOOL_PROVIDERS = ["exa", "firecrawl"] as const
export type ToolProvider = (typeof TOOL_PROVIDERS)[number]
export type ToolKeyMode = "platform" | "byok"

/** Maps tool provider IDs to their environment variable names */
const TOOL_ENV_MAP: Record<ToolProvider, string> = {
  exa: "EXA_API_KEY",
  firecrawl: "FIRECRAWL_API_KEY",
}

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
  const platformKey = process.env[TOOL_ENV_MAP[provider]] || undefined
  if (platformKey) {
    return { key: platformKey, keyMode: "platform" }
  }
  return {}
}
