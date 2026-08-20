import { api } from "@/convex/_generated/api"
import { FREE_MODELS_IDS } from "@/lib/config"
import { resolveModelId } from "@/lib/models/model-id-migration"
import {
  resolveModelRoute,
  type ResolvedModelRoute,
  type RouteResolutionFailure,
} from "@/lib/model-route-resolver"
import { MODEL_PROVIDER_IDENTITY, type Provider } from "@/lib/provider-identity"
import { type ProviderCredentialResolution } from "@/lib/user-keys"
import type { UIMessage } from "ai"
import { fetchMutation, fetchQuery } from "convex/nextjs"
import { extractApprovalResponses } from "./durable-turn-runtime"
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
  /** The requested model id — logical, legacy alias, or old routed id. */
  model: string
  isAuthenticated: boolean
  token?: string
  /** The turn's wire messages: capability requirements + approval pinning. */
  messages: UIMessage[]
}

export type ChatRouteAdmission = {
  /** Immutable route-resolution receipt (ADR-0020), persisted on the run. */
  route: ResolvedModelRoute
  /** Server-only credential fact the turn runtime consumes. Never logged. */
  credential: ProviderCredentialResolution
}

function turnRequiresVision(messages: UIMessage[]): boolean {
  const currentTurn = messages.at(-1)
  if (currentTurn?.role !== "user") return false

  return currentTurn.parts.some(
    (part) =>
      part.type === "file" &&
      typeof part.mediaType === "string" &&
      part.mediaType.startsWith("image/")
  )
}

/**
 * Approval continuations must stay pinned to the paused run's route. The
 * resolver is constrained to that provider here (best-effort, owner-checked
 * read); Convex's transactional `approval_provider_mismatch` check remains
 * the fail-closed enforcement either way.
 */
async function getPinnedContinuationProvider(
  messages: UIMessage[],
  token: string | undefined
): Promise<Provider | undefined> {
  if (!token) return undefined
  const responses = extractApprovalResponses(messages)
  const approvalId = responses[0]?.approvalId
  if (!approvalId) return undefined

  const facts = await fetchQuery(
    api.chatRuntime.getApprovalRouteFacts,
    { approvalId },
    { token }
  ).catch((error: unknown) => {
    console.warn(
      JSON.stringify({
        _tag: "approval_route_facts_lookup_failed",
        errorType: error instanceof Error ? error.name : typeof error,
      })
    )
    return null
  })
  const provider = facts?.provider
  return provider && provider in MODEL_PROVIDER_IDENTITY
    ? (provider as Provider)
    : undefined
}

function toAdmissionError(
  failure: RouteResolutionFailure
): PublicChatHttpError {
  if (failure.reason === "auth_required") {
    return new PublicChatHttpError({
      message:
        "This model requires authentication. Please sign in to access more models.",
      statusCode: 401,
      code: "AUTH_REQUIRED",
    })
  }
  if (failure.reason === "model_not_found") {
    return new PublicChatHttpError({
      message: `Model ${failure.modelId} not found`,
      statusCode: 400,
      code: "INVALID_REQUEST",
    })
  }
  if (failure.keyProviders.length === 0) {
    return new PublicChatHttpError({
      message:
        "This model has no route that supports this request (for example, image attachments).",
      statusCode: 400,
      code: "INVALID_REQUEST",
    })
  }
  const providerNames = failure.keyProviders
    .map((provider) => MODEL_PROVIDER_IDENTITY[provider].name)
    .join(" or ")
  return new PublicChatHttpError({
    message: `This model requires an API key for ${providerNames}. Please add your API key in settings or use a free model.`,
    statusCode: 401,
    code: "MISSING_API_KEY",
  })
}

/**
 * Validate access and resolve the one route + credential snapshot used by
 * the turn (ADR-0020). The client is never authoritative here: entitlement,
 * key presence, and decryption are all re-derived server-side.
 */
export async function validateAndResolveChatCredential({
  model,
  isAuthenticated,
  token,
  messages,
}: ChatCredentialAdmissionParams): Promise<ChatRouteAdmission> {
  const pinnedProviderId = isAuthenticated
    ? await getPinnedContinuationProvider(messages, token)
    : undefined

  const resolution = await resolveModelRoute({
    modelId: model,
    isAuthenticated,
    token: isAuthenticated ? token : undefined,
    requiredCapabilities: turnRequiresVision(messages)
      ? { vision: true }
      : undefined,
    pinnedProviderId,
  })

  if (!resolution.ok) {
    throw toAdmissionError(resolution)
  }

  return {
    route: resolution.route,
    credential: {
      provider: resolution.route.providerId,
      apiKey: resolution.apiKey,
      source: resolution.route.credentialSource,
    },
  }
}
