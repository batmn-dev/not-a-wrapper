import { describe, expect, it } from "vitest"
import {
  applyRelease,
  applyReserve,
  applySettle,
  bucketInvariantHolds,
  computeUsageCredits,
  creditsForTokens,
  reservationPayloadFingerprint,
  type BucketBalances,
} from "./usage_accounting"

describe("credit math (ADR-0021)", () => {
  it("prices input and output components independently", () => {
    // $5/1M in, $30/1M out → 5_000_000 / 30_000_000 credits per MTok.
    const rate = {
      inputCreditsPerMTok: 5_000_000,
      outputCreditsPerMTok: 30_000_000,
    }
    expect(
      computeUsageCredits(rate, { inputTokens: 1_000, outputTokens: 500 })
    ).toBe(5_000 + 15_000)
  })

  it("rounds ONCE per component with ceil, never per token", () => {
    // 3 credits per MTok: 1 token = 0.000003 credits → ceil = 1 credit, not
    // 1-per-token accumulated. 999_999 tokens at 1 credit/MTok = 0.999999 →
    // ceil = 1 (a fractional micro-USD never rounds to zero).
    expect(creditsForTokens(1, 3)).toBe(1)
    expect(creditsForTokens(999_999, 1)).toBe(1)
    expect(creditsForTokens(1_000_000, 1)).toBe(1)
    expect(creditsForTokens(1_000_001, 1)).toBe(2)
  })

  it("prices fractional source rates exactly at boundaries", () => {
    // $0.75/1M input → 750_000 credits/MTok. 4 tokens = 3 credits exactly.
    expect(creditsForTokens(4, 750_000)).toBe(3)
    expect(creditsForTokens(3, 750_000)).toBe(3) // 2.25 → ceil 3
  })

  it("treats zero-rate (free) routes and zero tokens as zero cost", () => {
    expect(creditsForTokens(50_000, 0)).toBe(0)
    expect(creditsForTokens(0, 5_000_000)).toBe(0)
    expect(creditsForTokens(undefined, 5_000_000)).toBe(0)
  })

  it("ignores negative and non-finite token counts", () => {
    expect(creditsForTokens(-5, 1_000_000)).toBe(0)
    expect(creditsForTokens(Number.NaN, 1_000_000)).toBe(0)
  })
})

describe("bucket balance transitions", () => {
  const bucket: BucketBalances = {
    grantedCredits: 1_000,
    availableCredits: 700,
    reservedCredits: 100,
    spentCredits: 200,
  }

  it("holds the materialized invariant on every transition", () => {
    expect(bucketInvariantHolds(bucket)).toBe(true)
    const reserved = applyReserve(bucket, 300)
    expect(reserved).toEqual({
      grantedCredits: 1_000,
      availableCredits: 400,
      reservedCredits: 400,
      spentCredits: 200,
    })
    expect(bucketInvariantHolds(reserved)).toBe(true)

    const settledBelow = applySettle(reserved, 300, 120)
    expect(settledBelow).toEqual({
      grantedCredits: 1_000,
      availableCredits: 580,
      reservedCredits: 100,
      spentCredits: 320,
    })
    expect(bucketInvariantHolds(settledBelow)).toBe(true)
  })

  it("records an overrun as a negative balance, never clamps", () => {
    const nearlyEmpty: BucketBalances = {
      grantedCredits: 1_000,
      availableCredits: 50,
      reservedCredits: 100,
      spentCredits: 850,
    }
    // Reservation was 100, actual cost 400: cost is never discarded.
    const settled = applySettle(nearlyEmpty, 100, 400)
    expect(settled.availableCredits).toBe(-250)
    expect(settled.spentCredits).toBe(1_250)
    expect(settled.reservedCredits).toBe(0)
    expect(bucketInvariantHolds(settled)).toBe(true)
  })

  it("release restores the full reservation without touching spend", () => {
    const released = applyRelease(bucket, 100)
    expect(released).toEqual({
      grantedCredits: 1_000,
      availableCredits: 800,
      reservedCredits: 0,
      spentCredits: 200,
    })
    expect(bucketInvariantHolds(released)).toBe(true)
  })
})

describe("reservation payload fingerprint", () => {
  const snapshot = {
    revision: "rev-1",
    currency: "USD" as const,
    primary: {
      modelId: "gpt-5-mini",
      routeId: "gpt-5-mini",
      providerId: "openai",
      upstreamModelId: "gpt-5-mini",
      inputCreditsPerMTok: 250_000,
      outputCreditsPerMTok: 2_000_000,
    },
  }
  const base = {
    requestId: "request-1",
    chatId: "chat-1",
    modelId: "gpt-5-mini",
    routeId: "gpt-5-mini",
    providerId: "openai",
    estimatedCredits: 1_234,
    estimatedInputTokens: 100,
    estimatedOutputTokens: 200,
    titleEstimatedCredits: 12,
    pricingSnapshot: snapshot,
  }

  it("is stable for identical payloads and distinct for changed ones", () => {
    expect(reservationPayloadFingerprint(base)).toBe(
      reservationPayloadFingerprint({ ...base })
    )
    expect(reservationPayloadFingerprint(base)).not.toBe(
      reservationPayloadFingerprint({ ...base, estimatedCredits: 1_235 })
    )
    expect(reservationPayloadFingerprint(base)).not.toBe(
      reservationPayloadFingerprint({ ...base, routeId: "other-route" })
    )
    expect(reservationPayloadFingerprint(base)).not.toBe(
      reservationPayloadFingerprint({ ...base, chatId: "chat-2" })
    )
    expect(reservationPayloadFingerprint(base)).not.toBe(
      reservationPayloadFingerprint({ ...base, estimatedInputTokens: 101 })
    )
  })

  it("covers the snapshot's integer rates, not just the revision string", () => {
    // A forged cheaper snapshot under the same revision must not replay as
    // identical.
    const cheaper = {
      ...base,
      pricingSnapshot: {
        ...snapshot,
        primary: { ...snapshot.primary, outputCreditsPerMTok: 0 },
      },
    }
    expect(reservationPayloadFingerprint(base)).not.toBe(
      reservationPayloadFingerprint(cheaper)
    )
  })
})
