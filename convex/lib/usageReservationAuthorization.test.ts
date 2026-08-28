import { describe, expect, it } from "vitest"
import type { PricingSnapshot } from "../domain/usage_accounting"
import {
  signUsageReservationAuthorization,
  USAGE_RESERVATION_AUTHORIZATION_MAX_AGE_MS,
  verifyUsageReservationAuthorization,
  type UsageReservationAuthorizationPayload,
} from "./usageReservationAuthorization"

const SECRET = "test-usage-reservation-secret-with-32-bytes"
const NOW = 1_700_000_000_000

const pricingSnapshot: PricingSnapshot = {
  revision: "catalog-v1",
  currency: "USD",
  primary: {
    modelId: "gpt-5-mini",
    routeId: "gpt-5-mini",
    providerId: "openai",
    upstreamModelId: "gpt-5-mini",
    inputCreditsPerMTok: 250_000,
    outputCreditsPerMTok: 2_000_000,
  },
  title: {
    modelId: "gpt-5-mini",
    routeId: "gpt-5-mini",
    providerId: "openai",
    upstreamModelId: "gpt-5-mini",
    inputCreditsPerMTok: 250_000,
    outputCreditsPerMTok: 2_000_000,
  },
}

const payload: UsageReservationAuthorizationPayload = {
  workosUserId: "workos-user-1",
  deploymentUrl: "https://preview-one.convex.cloud",
  requestId: "request-1",
  chatId: "chat-1",
  modelId: "gpt-5-mini",
  routeId: "gpt-5-mini",
  providerId: "openai",
  estimatedCredits: 25_000,
  estimatedInputTokens: 1_000,
  estimatedOutputTokens: 10_000,
  titleEstimatedCredits: 500,
  pricingSnapshot,
  issuedAt: NOW,
}

describe("usage reservation authorization", () => {
  it("accepts an intact, fresh server authorization", () => {
    const proof = signUsageReservationAuthorization(payload, SECRET)

    expect(
      verifyUsageReservationAuthorization(payload, proof, {
        secret: SECRET,
        now: NOW,
      })
    ).toBe(true)
  })

  it.each([
    ["user", { workosUserId: "workos-user-2" }],
    ["deployment", { deploymentUrl: "https://preview-two.convex.cloud" }],
    ["request", { requestId: "request-2" }],
    ["chat", { chatId: "chat-2" }],
    ["model", { modelId: "gpt-5" }],
    ["route", { routeId: "openrouter:openai/gpt-5-mini" }],
    ["provider", { providerId: "openrouter" }],
    ["estimated credits", { estimatedCredits: 0 }],
    ["input estimate", { estimatedInputTokens: 999 }],
    ["output estimate", { estimatedOutputTokens: 9_999 }],
    ["title estimate", { titleEstimatedCredits: 0 }],
    [
      "pricing revision",
      { pricingSnapshot: { ...pricingSnapshot, revision: "catalog-v2" } },
    ],
    [
      "pricing rate",
      {
        pricingSnapshot: {
          ...pricingSnapshot,
          primary: {
            ...pricingSnapshot.primary,
            outputCreditsPerMTok: 0,
          },
        },
      },
    ],
    [
      "title pricing rate",
      {
        pricingSnapshot: {
          ...pricingSnapshot,
          title: {
            ...(pricingSnapshot.title ?? pricingSnapshot.primary),
            inputCreditsPerMTok: 0,
          },
        },
      },
    ],
  ])("rejects a tampered %s", (_field, patch) => {
    const proof = signUsageReservationAuthorization(payload, SECRET)

    expect(
      verifyUsageReservationAuthorization({ ...payload, ...patch }, proof, {
        secret: SECRET,
        now: NOW,
      })
    ).toBe(false)
  })

  it("covers the title input floor with a versioned proof expansion", () => {
    // New payloads sign the widened v2 tuple; a payload WITHOUT the field
    // keeps the exact v1 serialization (the rollout window's old-server
    // proofs stay verifiable — pinned by the tests above, which omit it).
    const widened = { ...payload, titleEstimatedInputTokens: 250 }
    const proof = signUsageReservationAuthorization(widened, SECRET)
    expect(
      verifyUsageReservationAuthorization(widened, proof, {
        secret: SECRET,
        now: NOW,
      })
    ).toBe(true)
    // Tampering with, adding, or stripping the field breaks the proof.
    for (const tampered of [
      { ...widened, titleEstimatedInputTokens: 251 },
      { ...widened, titleEstimatedInputTokens: undefined },
    ]) {
      expect(
        verifyUsageReservationAuthorization(tampered, proof, {
          secret: SECRET,
          now: NOW,
        })
      ).toBe(false)
    }
    expect(
      verifyUsageReservationAuthorization(
        widened,
        signUsageReservationAuthorization(payload, SECRET),
        { secret: SECRET, now: NOW }
      )
    ).toBe(false)
  })

  it("rejects expired and materially future-dated authorizations", () => {
    const proof = signUsageReservationAuthorization(payload, SECRET)

    expect(
      verifyUsageReservationAuthorization(payload, proof, {
        secret: SECRET,
        now: NOW + USAGE_RESERVATION_AUTHORIZATION_MAX_AGE_MS + 1,
      })
    ).toBe(false)

    const futurePayload = { ...payload, issuedAt: NOW + 10_001 }
    expect(
      verifyUsageReservationAuthorization(
        futurePayload,
        signUsageReservationAuthorization(futurePayload, SECRET),
        { secret: SECRET, now: NOW }
      )
    ).toBe(false)
  })

  it("rejects malformed proofs and weak secrets", () => {
    expect(
      verifyUsageReservationAuthorization(payload, "not-a-proof", {
        secret: SECRET,
        now: NOW,
      })
    ).toBe(false)
    expect(() =>
      signUsageReservationAuthorization(payload, "too-short")
    ).toThrow("CHAT_ADMISSION_SECRET must be at least 32 bytes")
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects a non-finite token estimate instead of serializing %s as null",
    (estimatedInputTokens) => {
      const omitted = { ...payload, estimatedInputTokens: undefined }
      const proof = signUsageReservationAuthorization(omitted, SECRET)
      const tampered = { ...omitted, estimatedInputTokens }

      expect(
        verifyUsageReservationAuthorization(tampered, proof, {
          secret: SECRET,
          now: NOW,
        })
      ).toBe(false)
      expect(() => signUsageReservationAuthorization(tampered, SECRET)).toThrow(
        "Invalid usage reservation authorization payload"
      )
    }
  )
})
