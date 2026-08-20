import { api } from "@/convex/_generated/api"
import { getProviderStrategy } from "@/lib/openproviders/provider-strategy"
import type { Provider } from "@/lib/provider-identity"
import { getUserKeyFromConvex } from "@/lib/user-keys"
import { fetchQuery } from "convex/nextjs"
import {
  getLogicalModel,
  resolveModelSelection,
  type ModelRoute,
} from "./models/catalog"
import {
  freeModelsPlatformEntitlement,
  type PlatformEntitlement,
} from "./models/platform-entitlement"

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
  | "priority_byok"
  | "platform"
  | "fallback_byok"
  | "legacy_route_hint"

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
  reason: "model_not_found" | "auth_required" | "no_eligible_route"
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
}

export type RouteResolution = RouteResolutionSuccess | RouteResolutionFailure

export type RequiredRouteCapabilities = {
  /** The turn carries image input; only vision routes are candidates. */
  vision?: boolean
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
}

export type RouteResolverDeps = {
  getKeySettings(token: string): Promise<
    Array<{ provider: string; preference: ApiKeyPreference }>
  >
  getUserKey(provider: Provider, token: string): Promise<string | null>
  getPlatformKey(provider: Provider): string | undefined
  entitlement: PlatformEntitlement
}

const defaultDeps: RouteResolverDeps = {
  getKeySettings: (token) =>
    fetchQuery(api.userKeys.getKeySettings, {}, { token }),
  getUserKey: (provider, token) => getUserKeyFromConvex(provider, token),
  getPlatformKey: (provider) =>
    process.env[getProviderStrategy(provider).envVarName],
  entitlement: freeModelsPlatformEntitlement,
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
    return {
      ok: true,
      apiKey,
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

  return fail("no_eligible_route")
}
