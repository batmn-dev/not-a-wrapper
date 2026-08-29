import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { isServerChatId } from "@/lib/chat-store/identity"
import {
  reserveAuthorizedPlatformUsage,
  resolveModelRoute,
  type ResolvedModelRoute,
  type RouteResolutionFailure,
  type RouteResolverDeps,
} from "@/lib/model-route-resolver"
import type { ChatPerfServerSession } from "@/lib/observability/chat-performance"
import {
  resolveLogicalModelEffortLevels,
  resolveLogicalModelSearchMode,
} from "@/lib/models/catalog"
import type { ModelReasoningEffort } from "@/lib/models/types"
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

/**
 * Enforce the daily-message ABUSE limit before model execution (ADR-0021).
 * This is not economic admission — platform spend is admitted by the atomic
 * allowance reservation inside the route resolver, and BYOK messages never
 * touch allowance while still counting here as ordinary requests.
 */
export async function checkServerSideUsage(
  token: string | undefined,
  anonymousId?: string
): Promise<void> {
  const usage = await fetchQuery(
    api.usage.checkUsage,
    { anonymousId },
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
    throw new PublicChatHttpError({
      message: `Daily message limit reached (${usage.limit}). Please try again tomorrow.`,
      statusCode: 403,
      code: "DAILY_LIMIT_REACHED",
    })
  }
}

/** Record an admitted request against the abuse counter. */
export async function incrementServerSideUsage(
  token: string | undefined,
  anonymousId?: string
): Promise<void> {
  await fetchMutation(api.usage.incrementUsage, { anonymousId }, { token })
}

type ChatCredentialAdmissionParams = {
  /** The requested model id — logical, legacy alias, or old routed id. */
  model: string
  isAuthenticated: boolean
  /** Server-derived WorkOS subject; never accepted from the request body. */
  workosUserId?: string
  token?: string
  /** The turn's wire messages: capability requirements + approval pinning. */
  messages: UIMessage[]
  /** Platform-funding admission facts (ADR-0021). */
  requestId: string
  chatId: string
  systemPrompt?: string
  enableSearch: boolean
  /** Per-turn effort selection (ADR-0026); parser-validated, still soft. */
  reasoningEffort?: ModelReasoningEffort
  /** Optional user-selected total generation allowance (ADR-0028). */
  generationBudget?: number
  /** Server-planned approval continuation pin, when this is one. */
  pinnedProviderId?: Provider
  /**
   * Key-settings read started earlier in admission (Experiment 1): a pure
   * read of the caller's own settings, safe to overlap with the abuse check.
   * The resolver awaits it in place of its own round-trip.
   */
  keySettingsPromise?: ReturnType<RouteResolverDeps["getKeySettings"]>
  /** Sampled perf session; adds the `usage_reservation` sub-span. */
  perf?: ChatPerfServerSession
}

export type ChatRouteAdmission = {
  /** Immutable route-resolution receipt (ADR-0020), persisted on the run. */
  route: ResolvedModelRoute
  /** Server-only credential fact the turn runtime consumes. Never logged. */
  credential: ProviderCredentialResolution
  /** Platform allowance reservation admitted with the route (ADR-0021). */
  reservationId?: Id<"usageReservations">
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
  if (failure.reason === "insufficient_allowance") {
    // Reached only when no usable fallback BYOK route existed — allowance
    // exhaustion WITH a valid fallback key transparently chose BYOK instead.
    const providerNames = failure.keyProviders
      .map((provider) => MODEL_PROVIDER_IDENTITY[provider].name)
      .join(" or ")
    const addKeyHint = providerNames
      ? ` Add your ${providerNames} API key in Settings to keep using this model, or wait for your allowance to refill.`
      : " Wait for your allowance to refill."
    return new PublicChatHttpError({
      message: `You've used your included platform allowance for this period.${addKeyHint}`,
      statusCode: 403,
      code: "ALLOWANCE_EXHAUSTED",
    })
  }
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
  workosUserId,
  token,
  messages,
  requestId,
  chatId,
  systemPrompt,
  enableSearch,
  reasoningEffort,
  generationBudget,
  pinnedProviderId: plannedPinnedProviderId,
  keySettingsPromise,
  perf,
}: ChatCredentialAdmissionParams): Promise<ChatRouteAdmission> {
  const pinnedProviderId =
    plannedPinnedProviderId ??
    (isAuthenticated
      ? await getPinnedContinuationProvider(messages, token)
      : undefined)

  // Platform funding requires the durable accounting lifecycle (ADR-0021):
  // authenticated turns against a local/optimistic chat id cannot reserve or
  // settle, so they get no funding context and skip the platform tier.
  const platformFundingIdentity =
    isAuthenticated && workosUserId && token && isServerChatId(chatId)
      ? { workosUserId }
      : undefined

  const effectiveEnableSearch =
    resolveLogicalModelSearchMode(model) === "always-on" ? true : enableSearch
  // Soft effort preference (ADR-0026): steer resolution toward routes that
  // serve the requested level only when at least one route can — a model
  // whose routes all lack the level resolves unconstrained and the runtime
  // clamps instead, so an effort selection never fails a turn.
  const preferredEffort =
    reasoningEffort !== undefined &&
    resolveLogicalModelEffortLevels(model)?.includes(reasoningEffort)
      ? reasoningEffort
      : undefined
  const requiredCapabilities = {
    ...(turnRequiresVision(messages) ? { vision: true as const } : {}),
    webSearch: effectiveEnableSearch,
    ...(preferredEffort !== undefined
      ? { reasoningEffort: preferredEffort }
      : {}),
  }

  const resolution = await resolveModelRoute(
    {
      modelId: model,
      isAuthenticated,
      token: isAuthenticated ? token : undefined,
      requiredCapabilities,
      pinnedProviderId,
      ...(platformFundingIdentity
        ? {
            platformFunding: {
              workosUserId: platformFundingIdentity.workosUserId,
              requestId,
              chatId,
              messages,
              systemPrompt,
              toolsLikely: effectiveEnableSearch,
              ...(generationBudget !== undefined ? { generationBudget } : {}),
            },
          }
        : {}),
    },
    {
      ...(keySettingsPromise
        ? { getKeySettings: () => keySettingsPromise }
        : {}),
      ...(perf
        ? {
            reservePlatformUsage: (reserveArgs) =>
              perf.span("usage_reservation", () =>
                reserveAuthorizedPlatformUsage(reserveArgs)
              ),
          }
        : {}),
    }
  )

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
    ...(resolution.reservationId
      ? { reservationId: resolution.reservationId }
      : {}),
  }
}
