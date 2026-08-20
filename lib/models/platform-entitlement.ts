import { FREE_MODELS_IDS, NON_AUTH_ALLOWED_MODELS } from "@/lib/config"
import type { Provider } from "@/lib/provider-identity"
import { LOGICAL_MODELS, resolveModelSelection } from "./catalog"

/**
 * Platform entitlement (ADR-0020): the one typed answer to "may this route
 * run on platform-funded credentials for this actor?". The seam a future
 * plan/balance/quota/reservation system implements WITHOUT another selector
 * or catalog redesign — today's only implementation encodes the product
 * rules that already exist (the free-model list and the anonymous
 * allowlist). Billing state never lives in the catalog or the selector.
 */

export type PlatformEntitlementQuery = {
  /** Logical model id (pre-normalized ids are accepted). */
  modelId: string
  routeId: string
  providerId: Provider
  isAuthenticated: boolean
}

export type PlatformEntitlement = {
  isRouteEligible(query: PlatformEntitlementQuery): boolean
}

const FREE_LOGICAL_MODEL_IDS = new Set(
  FREE_MODELS_IDS.map((modelId) => resolveModelSelection(modelId).modelId)
)

const ANONYMOUS_LOGICAL_MODEL_IDS = new Set(
  NON_AUTH_ALLOWED_MODELS.map(
    (modelId) => resolveModelSelection(modelId).modelId
  )
)

/**
 * The current product rules: authenticated users may run free-listed models
 * on platform keys; anonymous users only the anonymous allowlist. Everything
 * else requires the user's own key.
 */
export const freeModelsPlatformEntitlement: PlatformEntitlement = {
  isRouteEligible({ modelId, isAuthenticated }) {
    const logicalId = resolveModelSelection(modelId).modelId
    if (!isAuthenticated) return ANONYMOUS_LOGICAL_MODEL_IDS.has(logicalId)
    return FREE_LOGICAL_MODEL_IDS.has(logicalId)
  },
}

export function isPlatformEligibleModelForActor(
  modelId: string,
  isAuthenticated: boolean
): boolean {
  const logicalId = resolveModelSelection(modelId).modelId
  return isAuthenticated
    ? FREE_LOGICAL_MODEL_IDS.has(logicalId)
    : ANONYMOUS_LOGICAL_MODEL_IDS.has(logicalId)
}

/**
 * Whether ANY model served by this provider's key also has a platform-funded
 * path. Where false, a Priority/Fallback preference cannot change behavior
 * today — key settings show an explanation instead of the control.
 */
export function providerHasPlatformEligibleAlternative(
  provider: Provider
): boolean {
  return LOGICAL_MODELS.some(
    (model) =>
      FREE_LOGICAL_MODEL_IDS.has(model.id) &&
      model.routes.some((route) => route.providerId === provider)
  )
}
