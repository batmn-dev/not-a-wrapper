import type { PersistedReasoningEffort } from "./reasoningEffort"
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
  /** Per-turn effort receipt (ADR-0026). Signing it makes a forged effort
   * receipt on the run row unrepresentable. */
  reasoningEffort?: {
    requested?: PersistedReasoningEffort
    applied?: PersistedReasoningEffort
  }
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
    payload.reasoningEffort
      ? [
          payload.reasoningEffort.requested ?? null,
          payload.reasoningEffort.applied ?? null,
        ]
      : null,
    payload.grantDigest ?? null,
    payload.reservationId ?? null,
    payload.generationInputHash ?? null,
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

  return timingSafeEqualHex(
    hmacSha256Hex(
      requireAdmissionSecret(
        options.secret ?? process.env.CHAT_ADMISSION_SECRET
      ),
      serializeAdmission(payload)
    ),
    proof
  )
}
