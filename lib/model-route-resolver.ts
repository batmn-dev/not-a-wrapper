import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  signUsageReservationAuthorization,
  usageReservationAuthorizationAudience,
} from "@/convex/lib/usageReservationAuthorization"
import type { UsageReservationArgs } from "@/convex/lib/usageValidators"
import type { ReserveUsageResult } from "@/convex/usageAllowance"
import { getProviderStrategy } from "@/lib/openproviders/provider-strategy"
import type { Provider } from "@/lib/provider-identity"
import { buildPricingSnapshot } from "@/lib/usage/billable-pricing"
import {
  estimatePlatformUsage,
  platformOutputTokenBudget,
} from "@/lib/usage/platform-usage-estimate"
import { getUserKeyFromConvex } from "@/lib/user-keys"
import type { UIMessage } from "ai"
import { fetchMutation, fetchQuery } from "convex/nextjs"
import {
  getLogicalModel,
  resolveModelSearchMode,
  resolveModelSelection,
  type ModelRoute,
} from "./models/catalog"
import {
  freeModelsPlatformEntitlement,
  type PlatformEntitlement,
} from "./models/platform-entitlement"
import type { ModelReasoningEffort } from "./models/types"

/**
 * Route resolver (ADR-0020): the ONE server-owned decision of how a chat
 * turn reaches its logical model. The client is never authoritative for
 * route selection, entitlement, or credential source — candidates are walked
 * against the ACTUAL server-side credential (BYOK decryption, platform env
 * var), so a client key-status boolean or an undecryptable stale ciphertext
 * can never admit a turn.
 *
 * Candidate precedence: priority BYOK → platform entitlement → fallback
 * BYOK. Within a tier, an approval pin or legacy route hint leads, then
 * direct-provider routes before aggregator routes, then catalog order.
 *
 * This is credential/route precedence BEFORE provider execution. It never
 * retries a provider failure on another route: runtime failover needs its
 * own retryable-error taxonomy and idempotency proof (explicitly out of
 * scope, see the ADR).
 */

export type ApiKeyPreference = "priority" | "fallback"

export type RouteReason =
  "priority_byok" | "platform" | "fallback_byok" | "legacy_route_hint"

export type ResolvedModelRoute = {
  modelId: string
  routeId: string
  providerId: Provider
  upstreamModelId: string
  credentialSource: "platform" | "byok"
  routeReason: RouteReason
}

export type RouteResolutionFailure = {
  ok: false
  reason:
    | "model_not_found"
    | "auth_required"
    | "no_eligible_route"
    /** Platform allowance could not cover any platform candidate and no
     * usable BYOK route existed (ADR-0021). */
    | "insufficient_allowance"
  modelId: string
  /**
   * Providers whose key would unlock a capability-eligible route — the
   * concise "add a key" path for the error surface. Never key material.
   */
  keyProviders: Provider[]
}

export type RouteResolutionSuccess = {
  ok: true
  route: ResolvedModelRoute
  /** The resolved credential. Consumed by the turn runtime; never logged. */
  apiKey: string
  /**
   * The platform-usage reservation admitted with this route (ADR-0021).
   * Present exactly when `credentialSource` is "platform" and the actor is
   * authenticated; attached to the generation run at durable prepare.
   */
  reservationId?: Id<"usageReservations">
}

export type RouteResolution = RouteResolutionSuccess | RouteResolutionFailure

export type RequiredRouteCapabilities = {
  /** The turn carries image input; only vision routes are candidates. */
  vision?: boolean
  /** Enabled excludes unsupported routes; disabled excludes always-on routes. */
  webSearch?: boolean
  /**
   * Per-turn effort preference (ADR-0026): only routes offering this level
   * are candidates. Soft by construction — the admission caller sets it only
   * when at least one route of the logical model supports the level, so an
   * effort selection steers routing but never empties the candidate set.
   */
  reasoningEffort?: ModelReasoningEffort
}

/**
 * The admission context a platform-funded candidate needs to reserve
 * allowance before it may be chosen (ADR-0021). Present only for
 * authenticated turns against durable chats — reservation and settlement
 * require the generation-run lifecycle, so an authenticated turn without
 * this context skips the platform tier entirely.
 */
export type PlatformFundingContext = {
  /** Server-authenticated WorkOS subject bound into the reserve capability. */
  workosUserId: string
  requestId: string
  chatId: string
  /** The turn's wire messages + prompt — estimation inputs only. */
  messages: UIMessage[]
  systemPrompt?: string
  /** Tools may run this turn (search enabled); widens the input estimate. */
  toolsLikely: boolean
}

export type ReservePlatformUsageArgs = Omit<
  UsageReservationArgs,
  "providerId"
> & {
  token: string
  workosUserId: string
  providerId: Provider
}

export type ResolveModelRouteArgs = {
  /** The selected model id — logical, legacy alias, or old routed id. */
  modelId: string
  isAuthenticated: boolean
  token?: string
  requiredCapabilities?: RequiredRouteCapabilities
  /**
   * Approval-continuation pin: constrain candidates to the paused run's
   * provider so a key added mid-pause cannot re-route the continuation.
   * Convex keeps the fail-closed enforcement either way.
   */
  pinnedProviderId?: Provider
  /**
   * Platform-funding admission context (ADR-0021). Absent → authenticated
   * platform candidates are skipped (anonymous turns stay on the separate
   * subsidized guest path and never reserve).
   */
  platformFunding?: PlatformFundingContext
}

export type RouteResolverDeps = {
  getKeySettings(
    token: string
  ): Promise<Array<{ provider: string; preference: ApiKeyPreference }>>
  getUserKey(provider: Provider, token: string): Promise<string | null>
  getPlatformKey(provider: Provider): string | undefined
  entitlement: PlatformEntitlement
  /**
   * The atomic allowance reservation (ADR-0021). A platform candidate is not
   * eligible until this succeeds; there is deliberately no separate balance
   * check (check-then-debit is the TOCTOU race the reservation removes).
   */
  reservePlatformUsage(
    args: ReservePlatformUsageArgs
  ): Promise<ReserveUsageResult>
}

/**
 * Reserve platform allowance through the signed server-authorized mutation.
 * Authorization and runtime failures pass through without downgrading to an
 * unsigned path.
 */
export async function reserveAuthorizedPlatformUsage({
  token,
  workosUserId,
  ...args
}: ReservePlatformUsageArgs): Promise<ReserveUsageResult> {
  const authorizationIssuedAt = Date.now()
  const authorizationProof = signUsageReservationAuthorization({
    ...args,
    workosUserId,
    deploymentUrl: usageReservationAuthorizationAudience(
      process.env.NEXT_PUBLIC_CONVEX_URL
    ),
    issuedAt: authorizationIssuedAt,
  })

  return fetchMutation(
    api.usageAllowance.reserveAuthorized,
    { ...args, authorizationIssuedAt, authorizationProof },
    { token }
  )
}

const defaultDeps: RouteResolverDeps = {
  getKeySettings: (token) =>
    fetchQuery(api.userKeys.getKeySettings, {}, { token }),
  getUserKey: (provider, token) => getUserKeyFromConvex(provider, token),
  getPlatformKey: (provider) =>
    process.env[getProviderStrategy(provider).envVarName],
  entitlement: freeModelsPlatformEntitlement,
  reservePlatformUsage: reserveAuthorizedPlatformUsage,
}

type Candidate = {
  route: ModelRoute
  credentialSource: "platform" | "byok"
  tierReason: Exclude<RouteReason, "legacy_route_hint">
  viaHint: boolean
}

function routeMeetsCapabilities(
  route: ModelRoute,
  required: RequiredRouteCapabilities | undefined
): boolean {
  if (required?.vision && route.config.vision !== true) return false
  if (required?.webSearch !== undefined) {
    const searchMode = resolveModelSearchMode(route.config)
    if (required.webSearch && searchMode === "unsupported") return false
    if (!required.webSearch && searchMode === "always-on") return false
  }
  if (
    required?.reasoningEffort !== undefined &&
    !route.config.effortLevels?.includes(required.reasoningEffort)
  ) {
    return false
  }
  return true
}

/** Direct-provider routes before aggregator routes; catalog order after. */
function orderTier(
  routes: ModelRoute[],
  hintRouteId: string | undefined
): Array<{ route: ModelRoute; viaHint: boolean }> {
  const ordered = [...routes].sort((a, b) => {
    const aAggregator = a.providerId === "openrouter" ? 1 : 0
    const bAggregator = b.providerId === "openrouter" ? 1 : 0
    return aAggregator - bAggregator
  })
  if (!hintRouteId) {
    return ordered.map((route) => ({ route, viaHint: false }))
  }
  const hintIndex = ordered.findIndex((route) => route.id === hintRouteId)
  if (hintIndex <= 0) {
    return ordered.map((route) => ({ route, viaHint: false }))
  }
  const [hinted] = ordered.splice(hintIndex, 1)
  return [
    { route: hinted!, viaHint: true },
    ...ordered.map((route) => ({ route, viaHint: false })),
  ]
}

export async function resolveModelRoute(
  args: ResolveModelRouteArgs,
  deps: RouteResolverDeps = defaultDeps
): Promise<RouteResolution> {
  const selection = resolveModelSelection(args.modelId)
  const model = getLogicalModel(selection.modelId)
  if (!model) {
    return {
      ok: false,
      reason: "model_not_found",
      modelId: selection.modelId,
      keyProviders: [],
    }
  }

  const capableRoutes = model.routes.filter(
    (route) =>
      routeMeetsCapabilities(route, args.requiredCapabilities) &&
      (args.pinnedProviderId === undefined ||
        route.providerId === args.pinnedProviderId)
  )
  const keyProviders = [
    ...new Set(capableRoutes.map((route) => route.providerId)),
  ]
  const fail = (
    reason: RouteResolutionFailure["reason"]
  ): RouteResolutionFailure => ({
    ok: false,
    reason,
    modelId: model.id,
    keyProviders,
  })

  const platformRoutes = capableRoutes.filter((route) =>
    deps.entitlement.isRouteEligible({
      modelId: model.id,
      routeId: route.id,
      providerId: route.providerId,
      isAuthenticated: args.isAuthenticated,
    })
  )

  // Anonymous turns run only on platform-entitled routes with platform
  // credentials — BYOK requires an authenticated key owner.
  if (!args.isAuthenticated) {
    if (platformRoutes.length === 0) return fail("auth_required")
    for (const { route } of orderTier(platformRoutes, undefined)) {
      const apiKey = deps.getPlatformKey(route.providerId)
      if (!apiKey) continue
      return {
        ok: true,
        apiKey,
        route: {
          modelId: model.id,
          routeId: route.id,
          providerId: route.providerId,
          upstreamModelId: route.upstreamModelId,
          credentialSource: "platform",
          routeReason: "platform",
        },
      }
    }
    return fail("no_eligible_route")
  }

  const keySettings = args.token ? await deps.getKeySettings(args.token) : []
  const preferenceByProvider = new Map(
    keySettings.map((entry) => [entry.provider, entry.preference])
  )

  const byokRoutes = (preference: ApiKeyPreference) =>
    capableRoutes.filter(
      (route) => preferenceByProvider.get(route.providerId) === preference
    )

  const hint = selection.legacyRouteHint
  const tiers: Candidate[] = [
    ...orderTier(byokRoutes("priority"), hint).map((entry) => ({
      ...entry,
      credentialSource: "byok" as const,
      tierReason: "priority_byok" as const,
    })),
    ...orderTier(platformRoutes, hint).map((entry) => ({
      ...entry,
      credentialSource: "platform" as const,
      tierReason: "platform" as const,
    })),
    ...orderTier(byokRoutes("fallback"), hint).map((entry) => ({
      ...entry,
      credentialSource: "byok" as const,
      tierReason: "fallback_byok" as const,
    })),
  ]

  let sawInsufficientAllowance = false

  for (const candidate of tiers) {
    const apiKey =
      candidate.credentialSource === "byok"
        ? args.token
          ? await deps.getUserKey(candidate.route.providerId, args.token)
          : null
        : (deps.getPlatformKey(candidate.route.providerId) ?? null)
    // A stored key that no longer decrypts (stale ciphertext) or a missing
    // platform env key disqualifies the candidate, not the model.
    if (!apiKey) continue

    // A platform candidate is not eligible until its allowance reservation
    // lands (ADR-0021): estimate → snapshot → atomic reserve, all before the
    // candidate can win. An unaffordable candidate falls through to the next
    // (possibly cheaper) platform route, then to fallback BYOK. Funding
    // requires the admission context (durable chat) — without it, or without
    // valid billable pricing, the candidate fails closed.
    let reservationId: Id<"usageReservations"> | undefined
    if (candidate.credentialSource === "platform") {
      const funding = args.platformFunding
      if (!funding || !args.token) continue
      const pricingSnapshot = buildPricingSnapshot(candidate.route)
      if (!pricingSnapshot) continue
      const estimate = estimatePlatformUsage({
        messages: funding.messages,
        systemPrompt: funding.systemPrompt,
        toolsLikely: funding.toolsLikely,
        pricingSnapshot,
        outputTokenBudget: platformOutputTokenBudget(candidate.route.config),
      })
      const reserved = await deps.reservePlatformUsage({
        token: args.token,
        workosUserId: funding.workosUserId,
        requestId: funding.requestId,
        chatId: funding.chatId,
        modelId: model.id,
        routeId: candidate.route.id,
        providerId: candidate.route.providerId,
        estimatedCredits: estimate.estimatedCredits,
        estimatedInputTokens: estimate.estimatedInputTokens,
        estimatedOutputTokens: estimate.estimatedOutputTokens,
        titleEstimatedCredits: estimate.titleEstimatedCredits,
        pricingSnapshot,
      })
      if (reserved.kind === "insufficient_allowance") {
        sawInsufficientAllowance = true
        continue
      }
      if (reserved.kind === "conflict" || reserved.kind === "rate_limited") {
        console.warn(
          JSON.stringify({
            _tag: "usage_reserve_candidate_skipped",
            reason: reserved.kind,
            routeId: candidate.route.id,
          })
        )
        continue
      }
      reservationId = reserved.reservationId
    }

    return {
      ok: true,
      apiKey,
      ...(reservationId ? { reservationId } : {}),
      route: {
        modelId: model.id,
        routeId: candidate.route.id,
        providerId: candidate.route.providerId,
        upstreamModelId: candidate.route.upstreamModelId,
        credentialSource: candidate.credentialSource,
        routeReason: candidate.viaHint
          ? "legacy_route_hint"
          : candidate.tierReason,
      },
    }
  }

  // Only when the allowance was the deciding factor: platform candidates
  // existed and were denied for balance, and no BYOK route could serve.
  return fail(
    sawInsufficientAllowance ? "insufficient_allowance" : "no_eligible_route"
  )
}
