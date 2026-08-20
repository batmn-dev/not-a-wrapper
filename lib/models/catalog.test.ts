import { describe, expect, it } from "vitest"
import {
  compileLogicalCatalog,
  getLogicalModel,
  LOGICAL_MODELS,
  resolveModelSelection,
  resolveModelSelections,
  ROUTE_CONFIGS,
} from "./catalog"
import type { ModelConfig } from "./types"

function makeConfig(overrides: Partial<ModelConfig> & { id: string }): ModelConfig {
  return {
    name: overrides.id,
    provider: "Test",
    providerId: "openai",
    catalogStatus: "visible",
    idKind: "stable",
    baseProviderId: "openai",
    ...overrides,
  }
}

describe("compileLogicalCatalog", () => {
  it("compiles direct and mapped wrapped records into one logical model", () => {
    const models = compileLogicalCatalog([
      makeConfig({ id: "direct-a", providerId: "anthropic" }),
      makeConfig({
        id: "openrouter:vendor/a",
        providerId: "openrouter",
        idKind: "wrapped",
        logicalModelId: "direct-a",
      }),
      makeConfig({
        id: "openrouter:vendor/b",
        providerId: "openrouter",
        idKind: "wrapped",
      }),
    ])

    expect(models.map((model) => model.id)).toEqual([
      "direct-a",
      "openrouter:vendor/b",
    ])
    const merged = models[0]!
    expect(merged.routes.map((route) => route.id)).toEqual([
      "direct-a",
      "openrouter:vendor/a",
    ])
    expect(merged.routes[1]!.upstreamModelId).toBe("vendor/a")
    // Every route belongs to exactly the model it compiled into.
    expect(merged.routes.every((route) => route.modelId === "direct-a")).toBe(
      true
    )
  })

  it("fails loudly on a mapping to a missing id", () => {
    expect(() =>
      compileLogicalCatalog([
        makeConfig({ id: "route-a", logicalModelId: "missing" }),
      ])
    ).toThrow(/does not exist/)
  })

  it("fails loudly on a chained mapping", () => {
    expect(() =>
      compileLogicalCatalog([
        makeConfig({ id: "a" }),
        makeConfig({ id: "b", logicalModelId: "c" }),
        makeConfig({ id: "c", logicalModelId: "a" }),
      ])
    ).toThrow(/chained/)
  })

  it("fails loudly on duplicate route ids", () => {
    expect(() =>
      compileLogicalCatalog([makeConfig({ id: "a" }), makeConfig({ id: "a" })])
    ).toThrow(/duplicate route id/)
  })

  it("fails loudly when a model would carry two routes on one provider", () => {
    expect(() =>
      compileLogicalCatalog([
        makeConfig({ id: "a", providerId: "openrouter" }),
        makeConfig({
          id: "openrouter:vendor/a",
          providerId: "openrouter",
          logicalModelId: "a",
        }),
      ])
    ).toThrow(/two/)
  })
})

describe("production logical catalog", () => {
  it("holds the structural invariants", () => {
    const logicalIds = LOGICAL_MODELS.map((model) => model.id)
    expect(new Set(logicalIds).size).toBe(logicalIds.length)

    // Every model has at least one route; every route belongs to its model
    // and appears exactly once across the catalog.
    const allRouteIds = LOGICAL_MODELS.flatMap((model) =>
      model.routes.map((route) => route.id)
    )
    expect(new Set(allRouteIds).size).toBe(allRouteIds.length)
    expect(allRouteIds.length).toBe(ROUTE_CONFIGS.length)
    for (const model of LOGICAL_MODELS) {
      expect(model.routes.length).toBeGreaterThan(0)
      expect(model.routes.every((route) => route.modelId === model.id)).toBe(
        true
      )
    }
  })

  it("merges the direct/OpenRouter duplicates into two-route models", () => {
    const sonnet = getLogicalModel("claude-sonnet-5")
    expect(sonnet?.routes.map((route) => route.id)).toEqual([
      "claude-sonnet-5",
      "openrouter:anthropic/claude-sonnet-5",
    ])
    expect(sonnet?.routes.map((route) => route.providerId)).toEqual([
      "anthropic",
      "openrouter",
    ])

    // The wrapped route id is no longer a logical model.
    expect(getLogicalModel("openrouter:anthropic/claude-sonnet-5")).toBe(
      undefined
    )
  })

  it("keeps OpenRouter-only models as single-route logical models", () => {
    const glm = getLogicalModel("openrouter:z-ai/glm-5.2")
    expect(glm?.routes.map((route) => route.providerId)).toEqual(["openrouter"])
  })

  it("keeps route-specific facts on the route, not the model", () => {
    const sonnet = getLogicalModel("claude-sonnet-5")!
    const direct = sonnet.routes[0]!.config
    const wrapped = sonnet.routes[1]!.config
    // The two routes legitimately disagree (e.g. native search support);
    // neither fact is flattened onto the logical model.
    expect(direct.webSearch).not.toBe(wrapped.webSearch)
  })
})

describe("resolveModelSelection", () => {
  it("resolves a merged wrapped id to its logical model with a route hint", () => {
    expect(resolveModelSelection("openrouter:anthropic/claude-sonnet-5")).toEqual({
      modelId: "claude-sonnet-5",
      legacyRouteHint: "openrouter:anthropic/claude-sonnet-5",
    })
  })

  it("keeps aliases and successions resolving first", () => {
    // Alias chain: deepseek-r1 → delisted free R1 → succession to GPT-OSS.
    expect(resolveModelSelection("deepseek-r1")).toEqual({
      modelId: "openrouter:openai/gpt-oss-120b:free",
    })
  })

  it("passes unknown ids through unchanged", () => {
    expect(resolveModelSelection("mystery-model")).toEqual({
      modelId: "mystery-model",
    })
  })

  it("deduplicates mixed legacy selections while preserving order", () => {
    expect(
      resolveModelSelections([
        "openrouter:anthropic/claude-sonnet-5",
        "claude-sonnet-5",
        "gpt-5.4",
        "openrouter:openai/gpt-5.4",
      ])
    ).toEqual(["claude-sonnet-5", "gpt-5.4"])
  })
})
