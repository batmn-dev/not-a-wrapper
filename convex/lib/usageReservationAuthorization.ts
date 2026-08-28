import { isValidUsageReservationArgs } from "../domain/usage_accounting"
import { hmacSha256Hex, timingSafeEqualHex } from "./sha256"
import type { UsageReservationArgs } from "./usageValidators"

export const USAGE_RESERVATION_AUTHORIZATION_MAX_AGE_MS = 60_000
const USAGE_RESERVATION_AUTHORIZATION_MAX_FUTURE_SKEW_MS = 10_000

export type UsageReservationAuthorizationPayload = UsageReservationArgs & {
  workosUserId: string
  /** Exact Convex deployment URL this capability may be redeemed against. */
  deploymentUrl: string
  issuedAt: number
}

function requireAuthorizationSecret(secret: string | undefined): string {
  if (!secret || new TextEncoder().encode(secret).length < 32) {
    throw new Error("CHAT_ADMISSION_SECRET must be at least 32 bytes")
  }
  return secret
}

function serializePricingRate(
  rate: UsageReservationArgs["pricingSnapshot"]["primary"]
): readonly [string, string, string, string, number, number] {
  const {
    modelId,
    routeId,
    providerId,
    upstreamModelId,
    inputCreditsPerMTok,
    outputCreditsPerMTok,
    ...unserialized
  } = rate
  unserialized satisfies Record<string, never>
  return [
    modelId,
    routeId,
    providerId,
    upstreamModelId,
    inputCreditsPerMTok,
    outputCreditsPerMTok,
  ]
}

export function usageReservationAuthorizationAudience(
  deploymentUrl: string | undefined
): string {
  if (!deploymentUrl) {
    throw new Error("Convex deployment URL is required for usage authorization")
  }
  const url = new URL(deploymentUrl)
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Convex deployment URL must use HTTP or HTTPS")
  }
  return url.origin
}

function serializeAuthorization(
  payload: UsageReservationAuthorizationPayload
): string {
  const {
    workosUserId,
    deploymentUrl,
    requestId,
    chatId,
    modelId,
    routeId,
    providerId,
    estimatedCredits,
    estimatedInputTokens,
    estimatedOutputTokens,
    titleEstimatedCredits,
    titleEstimatedInputTokens,
    pricingSnapshot,
    issuedAt,
    ...unserialized
  } = payload
  unserialized satisfies Record<string, never>
  const { revision, currency, primary, title, ...unserializedPricing } =
    pricingSnapshot
  unserializedPricing satisfies Record<string, never>

  const base = [
    workosUserId,
    usageReservationAuthorizationAudience(deploymentUrl),
    requestId,
    chatId,
    modelId,
    routeId,
    providerId,
    estimatedCredits,
    estimatedInputTokens ?? null,
    estimatedOutputTokens ?? null,
    titleEstimatedCredits ?? null,
    [
      revision,
      currency,
      serializePricingRate(primary),
      title ? serializePricingRate(title) : null,
    ],
    issuedAt,
  ] as const
  // Versioned expansion (rollout safety): payloads without the title input
  // floor keep the exact v1 serialization, so proofs signed by the previous
  // server build verify across the deploy; payloads carrying it sign the
  // widened v2 tuple. Both sides derive the version from the same payload,
  // so signer and verifier can never disagree.
  return JSON.stringify(
    titleEstimatedInputTokens === undefined
      ? ["usage-reservation-authorization-v1", ...base]
      : [
          "usage-reservation-authorization-v2",
          ...base,
          titleEstimatedInputTokens,
        ]
  )
}

/** Sign one server-derived allowance reservation for one authenticated user. */
export function signUsageReservationAuthorization(
  payload: UsageReservationAuthorizationPayload,
  secret = process.env.CHAT_ADMISSION_SECRET
): string {
  if (!isValidUsageReservationArgs(payload)) {
    throw new Error("Invalid usage reservation authorization payload")
  }
  return hmacSha256Hex(
    requireAuthorizationSecret(secret),
    serializeAuthorization(payload)
  )
}

/**
 * Verify that the Next server, not an untrusted client, derived every
 * reservation fact. The short lifetime limits replay exposure; request-level
 * idempotency still makes an intact replay harmless.
 */
export function verifyUsageReservationAuthorization(
  payload: UsageReservationAuthorizationPayload,
  proof: string,
  options: { secret?: string; now?: number } = {}
): boolean {
  if (!isValidUsageReservationArgs(payload)) return false
  if (!Number.isSafeInteger(payload.issuedAt)) return false
  const age = (options.now ?? Date.now()) - payload.issuedAt
  if (
    age < -USAGE_RESERVATION_AUTHORIZATION_MAX_FUTURE_SKEW_MS ||
    age > USAGE_RESERVATION_AUTHORIZATION_MAX_AGE_MS
  ) {
    return false
  }
  if (!/^[0-9a-f]{64}$/.test(proof)) return false

  const expected = hmacSha256Hex(
    requireAuthorizationSecret(
      options.secret ?? process.env.CHAT_ADMISSION_SECRET
    ),
    serializeAuthorization(payload)
  )
  return timingSafeEqualHex(expected, proof)
}
