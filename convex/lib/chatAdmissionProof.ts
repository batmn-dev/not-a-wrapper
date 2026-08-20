import { hmacSha256Hex, timingSafeEqualHex } from "./sha256"

export const CHAT_ADMISSION_PROOF_MAX_AGE_MS = 60_000
const CHAT_ADMISSION_PROOF_MAX_FUTURE_SKEW_MS = 10_000

export type ChatAdmissionRouteReceipt = {
  routeId: string
  credentialSource: "platform" | "byok"
  routeReason:
    "priority_byok" | "platform" | "fallback_byok" | "legacy_route_hint"
}

export type ChatAdmissionProofPayload = {
  chatId: string
  requestId: string
  model: string
  provider: string
  route?: ChatAdmissionRouteReceipt
  grantDigest?: string
  /** Platform-usage reservation attached at prepare (ADR-0021). Signing it
   * makes a forged or swapped reservation attach unrepresentable. */
  reservationId?: string
  /** Canonical durable-input plan confirmed transactionally at prepare. */
  generationInputHash?: string
  issuedAt: number
}

function requireAdmissionSecret(secret: string | undefined): string {
  if (!secret || new TextEncoder().encode(secret).length < 32) {
    throw new Error("CHAT_ADMISSION_SECRET must be at least 32 bytes")
  }
  return secret
}

function serializeAdmission(payload: ChatAdmissionProofPayload): string {
  return JSON.stringify([
    "chat-admission-v1",
    payload.chatId,
    payload.requestId,
    payload.model,
    payload.provider,
    payload.route
      ? [
          payload.route.routeId,
          payload.route.credentialSource,
          payload.route.routeReason,
        ]
      : null,
    payload.grantDigest ?? null,
    payload.reservationId ?? null,
    payload.generationInputHash ?? null,
    payload.issuedAt,
  ])
}

/**
 * Deploy-skew shim for the immediately previous format, which carried the
 * reservation but not the generation-input hash. Only a hash-less payload may
 * verify against it: a hash-carrying proof is new-format by construction.
 */
function serializeAdmissionWithoutInputHash(
  payload: ChatAdmissionProofPayload
): string {
  return JSON.stringify([
    "chat-admission-v1",
    payload.chatId,
    payload.requestId,
    payload.model,
    payload.provider,
    payload.route
      ? [
          payload.route.routeId,
          payload.route.credentialSource,
          payload.route.routeReason,
        ]
      : null,
    payload.grantDigest ?? null,
    payload.reservationId ?? null,
    payload.issuedAt,
  ])
}

/** Pre-ADR-0021 format, retained for one more deploy-skew window. */
function serializeAdmissionLegacy(payload: ChatAdmissionProofPayload): string {
  return JSON.stringify([
    "chat-admission-v1",
    payload.chatId,
    payload.requestId,
    payload.model,
    payload.provider,
    payload.route
      ? [
          payload.route.routeId,
          payload.route.credentialSource,
          payload.route.routeReason,
        ]
      : null,
    payload.grantDigest ?? null,
    payload.issuedAt,
  ])
}

export function signChatAdmissionProof(
  payload: ChatAdmissionProofPayload,
  secret = process.env.CHAT_ADMISSION_SECRET
): string {
  return hmacSha256Hex(
    requireAdmissionSecret(secret),
    serializeAdmission(payload)
  )
}

export function verifyChatAdmissionProof(
  payload: ChatAdmissionProofPayload,
  proof: string,
  options: { secret?: string; now?: number } = {}
): boolean {
  if (!Number.isSafeInteger(payload.issuedAt)) return false
  const age = (options.now ?? Date.now()) - payload.issuedAt
  if (
    age < -CHAT_ADMISSION_PROOF_MAX_FUTURE_SKEW_MS ||
    age > CHAT_ADMISSION_PROOF_MAX_AGE_MS
  ) {
    return false
  }
  if (!/^[0-9a-f]{64}$/.test(proof)) return false

  const secret = requireAdmissionSecret(
    options.secret ?? process.env.CHAT_ADMISSION_SECRET
  )
  if (
    timingSafeEqualHex(
      hmacSha256Hex(secret, serializeAdmission(payload)),
      proof
    )
  ) {
    return true
  }
  // Deploy-skew fallbacks are intentionally one-way: a fresh verifier accepts
  // a stale signer only when every field absent from the old format is also
  // absent from the payload.
  if (
    payload.generationInputHash === undefined &&
    timingSafeEqualHex(
      hmacSha256Hex(secret, serializeAdmissionWithoutInputHash(payload)),
      proof
    )
  ) {
    return true
  }
  return (
    payload.generationInputHash === undefined &&
    payload.reservationId === undefined &&
    timingSafeEqualHex(
      hmacSha256Hex(secret, serializeAdmissionLegacy(payload)),
      proof
    )
  )
}
