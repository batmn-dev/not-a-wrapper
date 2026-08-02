import { api } from "@/convex/_generated/api"
import { FREE_MODELS_IDS, NON_AUTH_ALLOWED_MODELS } from "@/lib/config"
import { resolveModelId } from "@/lib/models/model-id-migration"
import { getProviderForModel } from "@/lib/openproviders/provider-map"
import {
  getEffectiveProviderApiKey,
  type ProviderCredentialResolution,
} from "@/lib/user-keys"
import { fetchMutation, fetchQuery } from "convex/nextjs"
import { PublicChatHttpError } from "./public-http-error"

const USAGE_ERROR_CODES = {
  ANONYMOUS_ID_REQUIRED: "ANONYMOUS_ID_REQUIRED",
  USER_NOT_FOUND: "USER_NOT_FOUND",
} as const

const INTERNAL_SERVER_ERROR_MESSAGE = "Internal server error"

type UsageErrorCode = (typeof USAGE_ERROR_CODES)[keyof typeof USAGE_ERROR_CODES]

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
): PublicChatHttpError {
  const normalizedCode = normalizeUsageErrorCode(error, errorCode)

  if (normalizedCode === USAGE_ERROR_CODES.ANONYMOUS_ID_REQUIRED) {
    return new PublicChatHttpError({
      message: error,
      statusCode: 400,
      code: "INVALID_REQUEST",
    })
  }

  if (normalizedCode === USAGE_ERROR_CODES.USER_NOT_FOUND) {
    return new PublicChatHttpError({
      message: INTERNAL_SERVER_ERROR_MESSAGE,
      cause: new Error(error),
      statusCode: 500,
      code: "USER_NOT_FOUND",
    })
  }

  return new PublicChatHttpError({
    message: INTERNAL_SERVER_ERROR_MESSAGE,
    cause: new Error(error),
    statusCode: 500,
    code: "USAGE_CHECK_FAILED",
  })
}

/** Whether the model uses the stricter usage tier. */
export function isProModel(modelId: string): boolean {
  return !FREE_MODELS_IDS.includes(resolveModelId(modelId))
}

/** Enforce the Convex-backed usage limit before model execution. */
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
    throw new PublicChatHttpError({
      message: `Daily ${modelType} limit reached (${usage.limit}). Please try again tomorrow or upgrade your plan.`,
      statusCode: 403,
      code: "DAILY_LIMIT_REACHED",
    })
  }
}

/** Record admitted usage after request validation. */
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

type ChatCredentialAdmissionParams = {
  model: string
  isAuthenticated: boolean
  token?: string
}

/** Validate access and resolve the one credential snapshot used by the turn. */
export async function validateAndResolveChatCredential({
  model,
  isAuthenticated,
  token,
}: ChatCredentialAdmissionParams): Promise<ProviderCredentialResolution> {
  const resolvedModel = resolveModelId(model)

  if (
    !isAuthenticated &&
    !NON_AUTH_ALLOWED_MODELS.includes(resolvedModel)
  ) {
    throw new PublicChatHttpError({
      message:
        "This model requires authentication. Please sign in to access more models.",
      statusCode: 401,
      code: "AUTH_REQUIRED",
    })
  }

  const provider = getProviderForModel(resolvedModel)
  const credential = await getEffectiveProviderApiKey(
    provider,
    isAuthenticated ? token : undefined
  )

  if (
    isAuthenticated &&
    !FREE_MODELS_IDS.includes(resolvedModel) &&
    credential.source !== "byok"
  ) {
    throw new PublicChatHttpError({
      message: `This model requires an API key for ${provider}. Please add your API key in settings or use a free model.`,
      statusCode: 401,
      code: "MISSING_API_KEY",
    })
  }

  return credential
}
