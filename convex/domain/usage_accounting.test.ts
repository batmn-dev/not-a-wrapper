import { describe, expect, it } from "vitest"
import {
  applyRelease,
  applyReserve,
  applySettle,
  bucketInvariantHolds,
  computeUsageCredits,
  creditsForTokens,
  isValidTerminalUsageEvidence,
  reservationPayloadFingerprint,
  resolveTerminalUsageSettlement,
  type BucketBalances,
  type TerminalReservationFacts,
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

  it("expands to the v4 shape only when the title input floor is present", () => {
    // Rollout safety: old-server payloads (no titleEstimatedInputTokens)
    // keep the exact v3 serialization; new payloads version-bump and cover
    // the field.
    expect(reservationPayloadFingerprint(base)).toContain(
      "usage-reservation-fingerprint-v3"
    )
    const widened = { ...base, titleEstimatedInputTokens: 250 }
    expect(reservationPayloadFingerprint(widened)).toContain(
      "usage-reservation-fingerprint-v4"
    )
    expect(reservationPayloadFingerprint(widened)).not.toBe(
      reservationPayloadFingerprint({
        ...base,
        titleEstimatedInputTokens: 251,
      })
    )
  })
})

describe("cancellation terminal settlement decision (ADR-0021 amendment)", () => {
  // Fixture rates: primary $0.75/M in, $4.50/M out; title $0.10/M in,
  // $0.50/M out (integer micro-USD credits per MTok).
  const facts: TerminalReservationFacts = {
    reservedCredits: 100_000,
    estimatedInputTokens: 1_000,
    estimatedOutputTokens: 8_192,
    titleEstimatedCredits: 1_000,
    titleEstimatedInputTokens: 400,
    pricingSnapshot: {
      revision: "rev-1",
      currency: "USD",
      primary: {
        modelId: "gpt-5-mini",
        routeId: "gpt-5-mini",
        providerId: "openai",
        upstreamModelId: "gpt-5-mini",
        inputCreditsPerMTok: 750_000,
        outputCreditsPerMTok: 4_500_000,
      },
      title: {
        modelId: "gpt-5-nano",
        routeId: "gpt-5-nano",
        providerId: "openai",
        upstreamModelId: "gpt-5-nano",
        inputCreditsPerMTok: 100_000,
        outputCreditsPerMTok: 500_000,
      },
    },
  }
  const notRun = { kind: "not-run" } as const

  it("releases when provider work never began and no title ran", () => {
    expect(
      resolveTerminalUsageSettlement(facts, {
        primary: { kind: "not-started" },
        title: notRun,
      })
    ).toEqual({ kind: "release" })
  })

  it("charges the input floor for a first-step stop with no output", () => {
    const decision = resolveTerminalUsageSettlement(facts, {
      primary: { kind: "started-without-usage" },
      title: notRun,
    })
    // 1_000 estimated input × 0.75 = 750; no partial, no title.
    expect(decision).toMatchObject({
      kind: "settle",
      basis: "estimated_input_floor",
      actualCredits: 750,
      titleCredits: 0,
      titleBasis: "not_run",
    })
  })

  it("adds bounded persisted partial output on top of the input floor", () => {
    const decision = resolveTerminalUsageSettlement(facts, {
      primary: { kind: "started-without-usage", partialOutputTokens: 2_000 },
      title: notRun,
    })
    expect(decision).toMatchObject({
      basis: "estimated_input_with_partial_output",
      actualCredits: 750 + 9_000,
      outputTokens: 2_000,
    })
  })

  it("caps the partial-output estimate at the reserved output tokens", () => {
    const decision = resolveTerminalUsageSettlement(facts, {
      primary: { kind: "started-without-usage", partialOutputTokens: 100_000 },
      title: notRun,
    })
    expect(decision).toMatchObject({ outputTokens: 8_192 })
  })

  it("caps total fallback credits at the reservation, recording the uncapped value", () => {
    const tight = { ...facts, reservedCredits: 500 }
    const decision = resolveTerminalUsageSettlement(tight, {
      primary: { kind: "started-without-usage" },
      title: { kind: "started-without-usage" },
    })
    // Floor 750 + title floor 40 = 790, clamped to the 500 reservation.
    expect(decision).toMatchObject({
      actualCredits: 500,
      uncappedCredits: 790,
    })
  })

  it("prices completed-step usage without double-counting the partial estimate", () => {
    const decision = resolveTerminalUsageSettlement(facts, {
      // The partial estimate covers ALL persisted output, completed steps
      // included: output = max(observed, partial), never the sum.
      primary: {
        kind: "completed-steps",
        inputTokens: 1_000,
        outputTokens: 100,
        partialOutputTokens: 500,
      },
      title: notRun,
    })
    expect(decision).toMatchObject({
      basis: "observed_partial",
      inputTokens: 1_000,
      outputTokens: 500,
      actualCredits: 750 + 2_250,
    })
  })

  it("lets provider-reported actual usage honestly exceed the reservation", () => {
    const decision = resolveTerminalUsageSettlement(facts, {
      primary: { kind: "actual", inputTokens: 2_000_000_000, outputTokens: 0 },
      title: notRun,
    })
    expect(decision).toMatchObject({ basis: "actual" })
    expect(
      decision.kind === "settle" ? decision.actualCredits : 0
    ).toBeGreaterThan(facts.reservedCredits)
    expect(decision.kind === "settle" && decision.uncappedCredits).toBeFalsy()
  })

  it("prices title actual usage at the pinned attempted route", () => {
    const decision = resolveTerminalUsageSettlement(facts, {
      primary: { kind: "started-without-usage" },
      title: {
        kind: "actual",
        routeId: "gpt-5-nano",
        pricingRole: "title",
        inputTokens: 400,
        outputTokens: 8,
      },
    })
    expect(decision).toMatchObject({ titleCredits: 44, titleBasis: "actual" })
  })

  it("charges a started title at its input floor for the attempted route", () => {
    // Fallback attempt on the PRIMARY route: the floor prices at the primary
    // rate (400 × 0.75 = 300), still capped by the title reservation.
    const decision = resolveTerminalUsageSettlement(facts, {
      primary: { kind: "started-without-usage" },
      title: {
        kind: "started-without-usage",
        routeId: "gpt-5-mini",
        pricingRole: "primary",
      },
    })
    expect(decision).toMatchObject({
      titleCredits: 300,
      titleBasis: "input_floor",
      titleRouteUnrecognized: false,
    })
  })

  it("flags an unpinned title route and falls back to the pinned title floor", () => {
    const decision = resolveTerminalUsageSettlement(facts, {
      primary: { kind: "started-without-usage" },
      title: {
        kind: "actual",
        routeId: "unknown-route",
        pricingRole: "title",
        inputTokens: 400,
        outputTokens: 8,
      },
    })
    // 400 title-floor tokens × 0.10 = 40 at the pinned title rate.
    expect(decision).toMatchObject({
      titleCredits: 40,
      titleBasis: "input_floor",
      titleRouteUnrecognized: true,
    })
  })

  it("settles only the title when it started but the primary never did", () => {
    const decision = resolveTerminalUsageSettlement(facts, {
      primary: { kind: "not-started" },
      title: { kind: "started-without-usage" },
    })
    expect(decision).toMatchObject({ actualCredits: 40, titleCredits: 40 })
  })

  it("falls back to the legacy title estimate when no input floor was pinned", () => {
    const legacy = { ...facts, titleEstimatedInputTokens: undefined }
    const decision = resolveTerminalUsageSettlement(legacy, {
      primary: { kind: "started-without-usage" },
      title: { kind: "started-without-usage" },
    })
    expect(decision).toMatchObject({ titleCredits: 1_000 })
  })

  it("rejects malformed and negative token counts", () => {
    expect(
      isValidTerminalUsageEvidence({
        primary: { kind: "started-without-usage", partialOutputTokens: -1 },
        title: notRun,
      })
    ).toBe(false)
    expect(
      isValidTerminalUsageEvidence({
        primary: { kind: "actual", inputTokens: Number.NaN },
        title: notRun,
      })
    ).toBe(false)
    expect(
      isValidTerminalUsageEvidence({
        primary: { kind: "completed-steps", inputTokens: 10, outputTokens: 2 },
        title: {
          kind: "actual",
          routeId: "gpt-5-nano",
          pricingRole: "title",
          inputTokens: 1.5,
        },
      })
    ).toBe(false)
    expect(
      isValidTerminalUsageEvidence({
        primary: { kind: "not-started" },
        title: notRun,
      })
    ).toBe(true)
  })
})
