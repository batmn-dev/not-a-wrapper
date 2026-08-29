import { describe, expect, it } from "vitest"
import {
  CANCELLATION_SETTLEMENT_PROTOCOL_VERSION,
  CHAT_ADMISSION_PROOF_MAX_AGE_MS,
  signChatAdmissionProof,
  verifyChatAdmissionProof,
  type ChatAdmissionProofPayload,
} from "./chatAdmissionProof"
import { hmacSha256Hex } from "./sha256"

const SECRET = "test-chat-admission-secret-with-32-bytes"
const NOW = 1_700_000_000_000

const payload: ChatAdmissionProofPayload = {
  chatId: "chat_1",
  requestId: "request_1",
  model: "claude-sonnet-5",
  provider: "openrouter",
  route: {
    routeId: "openrouter:anthropic/claude-sonnet-5",
    credentialSource: "byok",
    routeReason: "priority_byok",
  },
  grantDigest: "a".repeat(64),
  cancellationSettlementVersion:
    CANCELLATION_SETTLEMENT_PROTOCOL_VERSION,
  issuedAt: NOW,
}

describe("chat admission proof", () => {
  it("matches the RFC 4231 HMAC-SHA-256 test vector", () => {
    expect(
      hmacSha256Hex(
        String.fromCharCode(...Array<number>(20).fill(0x0b)),
        "Hi There"
      )
    ).toBe("b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7")
  })

  it("accepts an intact, fresh server-signed admission", () => {
    const proof = signChatAdmissionProof(payload, SECRET)

    expect(
      verifyChatAdmissionProof(payload, proof, { secret: SECRET, now: NOW })
    ).toBe(true)
  })

  it("rejects the retired v1 format", () => {
    const v1Proof = hmacSha256Hex(
      SECRET,
      JSON.stringify([
        "chat-admission-v1",
        payload.chatId,
        payload.requestId,
        payload.model,
        payload.provider,
        [
          payload.route!.routeId,
          payload.route!.credentialSource,
          payload.route!.routeReason,
        ],
        payload.grantDigest,
        null,
        null,
        payload.issuedAt,
      ])
    )

    expect(
      verifyChatAdmissionProof(payload, v1Proof, {
        secret: SECRET,
        now: NOW,
      })
    ).toBe(false)
  })

  it("binds reasoning effort into the admission proof", () => {
    const withEffort: ChatAdmissionProofPayload = {
      ...payload,
      reasoningEffort: { requested: "high", applied: "medium" },
    }
    const proof = signChatAdmissionProof(withEffort, SECRET)

    expect(
      verifyChatAdmissionProof(withEffort, proof, { secret: SECRET, now: NOW })
    ).toBe(true)
    expect(
      verifyChatAdmissionProof(
        {
          ...withEffort,
          reasoningEffort: { requested: "high", applied: "low" },
        },
        proof,
        { secret: SECRET, now: NOW }
      )
    ).toBe(false)
  })

  it.each([
    ["chat", { chatId: "chat_2" }],
    ["request", { requestId: "request_2" }],
    ["model", { model: "gpt-5" }],
    ["provider", { provider: "anthropic" }],
    ["route id", { route: { ...payload.route!, routeId: "claude-sonnet-5" } }],
    [
      "credential source",
      {
        route: {
          ...payload.route!,
          credentialSource: "platform" as const,
        },
      },
    ],
    [
      "route reason",
      {
        route: { ...payload.route!, routeReason: "fallback_byok" as const },
      },
    ],
    ["grant", { grantDigest: "b".repeat(64) }],
    ["generation input", { generationInputHash: "b".repeat(64) }],
  ])("rejects a tampered %s", (_field, patch) => {
    const proof = signChatAdmissionProof(payload, SECRET)

    expect(
      verifyChatAdmissionProof({ ...payload, ...patch }, proof, {
        secret: SECRET,
        now: NOW,
      })
    ).toBe(false)
  })

  it("rejects expired and materially future-dated admissions", () => {
    const proof = signChatAdmissionProof(payload, SECRET)

    expect(
      verifyChatAdmissionProof(payload, proof, {
        secret: SECRET,
        now: NOW + CHAT_ADMISSION_PROOF_MAX_AGE_MS + 1,
      })
    ).toBe(false)
    expect(
      verifyChatAdmissionProof(
        { ...payload, issuedAt: NOW + 10_001 },
        signChatAdmissionProof({ ...payload, issuedAt: NOW + 10_001 }, SECRET),
        { secret: SECRET, now: NOW }
      )
    ).toBe(false)
  })

  it("binds the reservation id into the signed tuple", () => {
    const withReservation = { ...payload, reservationId: "res-1" }
    const proof = signChatAdmissionProof(withReservation, SECRET)
    expect(
      verifyChatAdmissionProof(withReservation, proof, {
        secret: SECRET,
        now: NOW,
      })
    ).toBe(true)
    // Swapping or dropping the reservation invalidates the proof.
    expect(
      verifyChatAdmissionProof({ ...payload, reservationId: "res-2" }, proof, {
        secret: SECRET,
        now: NOW,
      })
    ).toBe(false)
    expect(
      verifyChatAdmissionProof(payload, proof, { secret: SECRET, now: NOW })
    ).toBe(false)
  })

  it("rejects the retired v2 format", () => {
    const v2Proof = hmacSha256Hex(
      SECRET,
      JSON.stringify([
        "chat-admission-v2",
        payload.chatId,
        payload.requestId,
        payload.model,
        payload.provider,
        [
          payload.route!.routeId,
          payload.route!.credentialSource,
          payload.route!.routeReason,
        ],
        null,
        payload.grantDigest,
        null,
        null,
        payload.issuedAt,
      ])
    )
    expect(
      verifyChatAdmissionProof(payload, v2Proof, {
        secret: SECRET,
        now: NOW,
      })
    ).toBe(false)
  })

  it("rejects malformed proofs and weak secrets", () => {
    expect(
      verifyChatAdmissionProof(payload, "not-a-proof", {
        secret: SECRET,
        now: NOW,
      })
    ).toBe(false)
    expect(() => signChatAdmissionProof(payload, "too-short")).toThrow(
      "CHAT_ADMISSION_SECRET must be at least 32 bytes"
    )
  })
})
