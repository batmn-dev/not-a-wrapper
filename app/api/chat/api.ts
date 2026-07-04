import type { ChatApiParams } from "@/app/types/api.types"
import { api } from "@/convex/_generated/api"
import { FREE_MODELS_IDS, NON_AUTH_ALLOWED_MODELS } from "@/lib/config"
import { resolveModelId } from "@/lib/models/model-id-migration"
import { getProviderForModel } from "@/lib/openproviders/provider-map"
import { hasUserKey } from "@/lib/user-keys"
import { fetchMutation, fetchQuery } from "convex/nextjs"

/**
 * Check if a model is a "pro" model (requires more stringent limits)
 */
export function isProModel(modelId: string): boolean {
  return !FREE_MODELS_IDS.includes(resolveModelId(modelId))
}

/**
 * Server-side usage check using Convex with authenticated token
 * This enforces rate limits before allowing the request to proceed
 *
 * @param token - Convex auth token (undefined for anonymous users)
 * @param modelId - The model being used
 * @param anonymousId - Client-generated ID for anonymous users (required if no token)
 */
export async function checkServerSideUsage(
  token: string | undefined,
  modelId: string,
  anonymousId?: string
): Promise<void> {
  const isPro = isProModel(modelId)

  const usage = await fetchQuery(
    api.usage.checkUsage,
    { isProModel: isPro, anonymousId },
    { token }
  )

  if (!usage.canSend) {
    // Surface specific error messages (e.g., "User not found", "Anonymous ID required")
    // before falling back to the generic rate limit message
    if (usage.error) {
      throw new Error(usage.error)
    }
    const modelType = isPro ? "pro model" : "message"
    throw new Error(
      `Daily ${modelType} limit reached (${usage.limit}). Please try again tomorrow or upgrade your plan.`
    )
  }
}

/**
 * Server-side usage increment using Convex with authenticated token
 * This is called after successful validation to track usage
 *
 * @param token - Convex auth token (undefined for anonymous users)
 * @param modelId - The model being used
 * @param anonymousId - Client-generated ID for anonymous users (required if no token)
 */
export async function incrementServerSideUsage(
  token: string | undefined,
  modelId: string,
  anonymousId?: string
): Promise<void> {
  const isPro = isProModel(modelId)

  await fetchMutation(
    api.usage.incrementUsage,
    { isProModel: isPro, anonymousId },
    { token }
  )
}

/**
 * Validate user access to model and check for required API keys
 * Note: Usage rate-limiting is now enforced via checkServerSideUsage
 */
export async function validateAndTrackUsage({
  userId,
  model,
  isAuthenticated,
  token,
}: ChatApiParams): Promise<null> {
  const resolvedModel = resolveModelId(model)

  // Check if user is authenticated
  if (!isAuthenticated) {
    // For unauthenticated users, only allow specific models
    if (!NON_AUTH_ALLOWED_MODELS.includes(resolvedModel)) {
      throw new Error(
        "This model requires authentication. Please sign in to access more models."
      )
    }
  } else {
    // For authenticated users, check API key requirements
    const provider = getProviderForModel(resolvedModel)

    // Check if user has their own API key for this provider
    const hasKey = await hasUserKey(provider, token)

    // If no API key and model is not in free list, deny access
    if (!hasKey && !FREE_MODELS_IDS.includes(resolvedModel)) {
      throw new Error(
        `This model requires an API key for ${provider}. Please add your API key in settings or use a free model.`
      )
    }
  }

  void userId // userId kept for type compatibility but not used here
  return null
}
