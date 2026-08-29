import { getLogicalModel } from "@/lib/models/catalog"
import type { ModelConfig } from "@/lib/models/types"
import { PLATFORM_RESPONSE_OUTPUT_TOKENS } from "@/lib/openproviders/output-budget"
import { describe, expect, it } from "vitest"
import {
  buildPricingSnapshot,
  buildRoutePricingRate,
  PLATFORM_PRICING_REVISION,
} from "./billable-pricing"
import { estimatePlatformUsage } from "./platform-usage-estimate"

function routeOf(modelId: string) {
  const model = getLogicalModel(modelId)
  if (!model) throw new Error(`fixture model missing: ${modelId}`)
  return model.routes[0]!
}

describe("billable route pricing (ADR-0021)", () => {
  it("compiles USD-per-1M float rates into integer micro-USD rates", () => {
    // gpt-5-mini: $0.25 in / $2.00 out per 1M in the catalog fixture era —
    // read the actual config so the test tracks the catalog.
    const route = routeOf("gpt-5-mini")
    const rate = buildRoutePricingRate(route.config, route.modelId)
    expect(rate).not.toBeNull()
    expect(rate!.inputCreditsPerMTok).toBe(
      Math.round((route.config.inputCost ?? 0) * 1_000_000)
    )
    expect(Number.isSafeInteger(rate!.inputCreditsPerMTok)).toBe(true)
    expect(Number.isSafeInteger(rate!.outputCreditsPerMTok)).toBe(true)
  })

  it("fails closed for routes without valid numeric pricing", () => {
    const unpriced = {
      ...routeOf("gpt-5-mini").config,
      inputCost: undefined,
    } as ModelConfig
    expect(buildRoutePricingRate(unpriced, "gpt-5-mini")).toBeNull()

    const negative = {
      ...routeOf("gpt-5-mini").config,
      outputCost: -1,
    } as ModelConfig
    expect(buildRoutePricingRate(negative, "gpt-5-mini")).toBeNull()
  })

  it("accepts explicitly free routes at zero rates", () => {
    const free = {
      ...routeOf("gpt-5-mini").config,
      inputCost: 0,
      outputCost: 0,
    } as ModelConfig
    const rate = buildRoutePricingRate(free, "free-model")
    expect(rate).toMatchObject({
      inputCreditsPerMTok: 0,
      outputCreditsPerMTok: 0,
    })
  })

  it("builds a snapshot carrying the title route's own rates", () => {
    const snapshot = buildPricingSnapshot(routeOf("gpt-5.5"))
    expect(snapshot).not.toBeNull()
    expect(snapshot!.revision).toBe(PLATFORM_PRICING_REVISION)
    expect(snapshot!.currency).toBe("USD")
    // The title model is a cheap same-provider pick, priced independently.
    expect(snapshot!.title).toBeDefined()
    expect(snapshot!.title!.providerId).toBe(snapshot!.primary.providerId)
    expect(
      snapshot!.title!.inputCreditsPerMTok
    ).toBeLessThanOrEqual(snapshot!.primary.inputCreditsPerMTok)
  })

  it("keeps a built snapshot stable when the catalog object mutates", () => {
    const source = routeOf("gpt-5-mini")
    const route = { ...source, config: { ...source.config, inputCost: 1 } }
    const snapshot = buildPricingSnapshot(route)!
    const before = snapshot.primary.inputCreditsPerMTok
    // A later catalog change must not re-price an already-built snapshot.
    route.config.inputCost = 10
    expect(snapshot.primary.inputCreditsPerMTok).toBe(before)
    expect(buildPricingSnapshot(route)!.primary.inputCreditsPerMTok).not.toBe(
      before
    )
  })
})

describe("platform output token reservation", () => {
  it("flows into the estimate's output component", () => {
    const snapshot = buildPricingSnapshot(routeOf("gpt-5-mini"))!
    const estimate = estimatePlatformUsage({
      messages: [],
      toolsLikely: false,
      pricingSnapshot: snapshot,
      outputTokenBudget: 20_000,
    })
    expect(estimate.estimatedOutputTokens).toBe(20_000)
  })
})

describe("platform usage estimation", () => {
  const snapshot = buildPricingSnapshot(routeOf("gpt-5-mini"))!

  it("charges history, system prompt, tools, and the output reservation", () => {
    const base = estimatePlatformUsage({
      messages: [
        {
          id: "u1",
          role: "user",
          parts: [{ type: "text", text: "a".repeat(400) }],
        },
      ] as never,
      systemPrompt: "b".repeat(400),
      toolsLikely: false,
      pricingSnapshot: snapshot,
      outputTokenBudget: PLATFORM_RESPONSE_OUTPUT_TOKENS,
    })
    expect(base.estimatedOutputTokens).toBe(PLATFORM_RESPONSE_OUTPUT_TOKENS)
    expect(base.estimatedInputTokens).toBeGreaterThanOrEqual(200)
    expect(base.estimatedCredits).toBeGreaterThan(0)
    expect(base.titleEstimatedCredits).toBeGreaterThan(0)

    const withTools = estimatePlatformUsage({
      messages: [],
      toolsLikely: true,
      pricingSnapshot: snapshot,
      outputTokenBudget: PLATFORM_RESPONSE_OUTPUT_TOKENS,
    })
    const withoutTools = estimatePlatformUsage({
      messages: [],
      toolsLikely: false,
      pricingSnapshot: snapshot,
      outputTokenBudget: PLATFORM_RESPONSE_OUTPUT_TOKENS,
    })
    expect(withTools.estimatedInputTokens).toBeGreaterThan(
      withoutTools.estimatedInputTokens
    )
  })

  it("adds a flat allowance per image attachment", () => {
    const withImage = estimatePlatformUsage({
      messages: [
        {
          id: "u1",
          role: "user",
          parts: [
            { type: "text", text: "look" },
            { type: "file", mediaType: "image/png", url: "convex://f" },
          ],
        },
      ] as never,
      toolsLikely: false,
      pricingSnapshot: snapshot,
      outputTokenBudget: PLATFORM_RESPONSE_OUTPUT_TOKENS,
    })
    const withoutImage = estimatePlatformUsage({
      messages: [
        {
          id: "u1",
          role: "user",
          parts: [{ type: "text", text: "look" }],
        },
      ] as never,
      toolsLikely: false,
      pricingSnapshot: snapshot,
      outputTokenBudget: PLATFORM_RESPONSE_OUTPUT_TOKENS,
    })
    expect(
      withImage.estimatedInputTokens - withoutImage.estimatedInputTokens
    ).toBeGreaterThanOrEqual(1_000)
  })

  it("estimates zero credits for zero-rate routes but keeps token counts", () => {
    const freeSnapshot = {
      ...snapshot,
      primary: {
        ...snapshot.primary,
        inputCreditsPerMTok: 0,
        outputCreditsPerMTok: 0,
      },
      title: {
        ...snapshot.title!,
        inputCreditsPerMTok: 0,
        outputCreditsPerMTok: 0,
      },
    }
    const estimate = estimatePlatformUsage({
      messages: [
        {
          id: "u1",
          role: "user",
          parts: [{ type: "text", text: "hello" }],
        },
      ] as never,
      toolsLikely: false,
      pricingSnapshot: freeSnapshot,
      outputTokenBudget: PLATFORM_RESPONSE_OUTPUT_TOKENS,
    })
    expect(estimate.estimatedCredits).toBe(0)
    expect(estimate.estimatedInputTokens).toBeGreaterThan(0)
  })
})
