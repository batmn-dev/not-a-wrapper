import type { ChatApiParams } from "@/app/types/api.types"
import { api } from "@/convex/_generated/api"
import { FREE_MODELS_IDS, NON_AUTH_ALLOWED_MODELS } from "@/lib/config"
import { resolveModelId } from "@/lib/models/model-id-migration"
import { getProviderForModel } from "@/lib/openproviders/provider-map"
import { hasUserKey } from "@/lib/user-keys"
import { fetchMutation, fetchQuery } from "convex/nextjs"

const USAGE_ERROR_CODES = {
  ANONYMOUS_ID_REQUIRED: "ANONYMOUS_ID_REQUIRED",
  USER_NOT_FOUND: "USER_NOT_FOUND",
} as const

type UsageErrorCode = (typeof USAGE_ERROR_CODES)[keyof typeof USAGE_ERROR_CODES]

type ChatApiError = Error & {
  statusCode: number
  code: string
}

function normalizeUsageErrorCode(
  error: string,
  errorCode: unknown
): UsageErrorCode | "UNKNOWN" {
  if (
    errorCode === USAGE_ERROR_CODES.ANONYMOUS_ID_REQUIRED ||
    errorCode === USAGE_ERROR_CODES.USER_NOT_FOUND
  ) {
    return errorCode
  }

  if (error === "Anonymous ID required for usage tracking") {
    return USAGE_ERROR_CODES.ANONYMOUS_ID_REQUIRED
  }

  if (error === "User not found") {
    return USAGE_ERROR_CODES.USER_NOT_FOUND
  }

  return "UNKNOWN"
}

function createUsageCheckApiError(
  error: string,
  errorCode?: unknown
): ChatApiError {
  const normalizedCode = normalizeUsageErrorCode(error, errorCode)

  if (normalizedCode === USAGE_ERROR_CODES.ANONYMOUS_ID_REQUIRED) {
    return Object.assign(new Error(error), {
      statusCode: 400,
      code: "INVALID_REQUEST",
    })
  }

  if (normalizedCode === USAGE_ERROR_CODES.USER_NOT_FOUND) {
    return Object.assign(new Error(error), {
      statusCode: 500,
      code: "USER_NOT_FOUND",
    })
  }

  return Object.assign(new Error(error), {
    statusCode: 500,
    code: "USAGE_CHECK_FAILED",
  })
}

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
    // Surface specific usage-check failures before falling back to the generic
    // rate-limit message. Status codes ride the ApiError shape so
    // createErrorResponse maps them explicitly.
    if (usage.error) {
      throw createUsageCheckApiError(
        usage.error,
        "errorCode" in usage ? usage.errorCode : undefined
      )
    }
    const modelType = isPro ? "pro model" : "message"
    throw Object.assign(
      new Error(
        `Daily ${modelType} limit reached (${usage.limit}). Please try again tomorrow or upgrade your plan.`
      ),
      { statusCode: 403, code: "DAILY_LIMIT_REACHED" }
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
      throw Object.assign(
        new Error(
          "This model requires authentication. Please sign in to access more models."
        ),
        { statusCode: 401, code: "AUTH_REQUIRED" }
      )
    }
  } else {
    // For authenticated users, check API key requirements
    const provider = getProviderForModel(resolvedModel)

    // Check if user has their own API key for this provider
    const hasKey = await hasUserKey(provider, token)

    // If no API key and model is not in free list, deny access
    if (!hasKey && !FREE_MODELS_IDS.includes(resolvedModel)) {
      throw Object.assign(
        new Error(
          `This model requires an API key for ${provider}. Please add your API key in settings or use a free model.`
        ),
        { statusCode: 401, code: "MISSING_API_KEY" }
      )
    }
  }

  void userId // userId kept for type compatibility but not used here
  return null
}
