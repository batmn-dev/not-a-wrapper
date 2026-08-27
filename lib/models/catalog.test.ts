import { describe, expect, it } from "vitest"
import {
  auditLogicalModelPriorities,
  classifyLogicalModel,
  compileLogicalCatalog,
  getLogicalModel,
  LOGICAL_MODELS,
  resolveModelSearchMode,
  resolveModelSelection,
  resolveModelSelections,
  ROUTE_CONFIGS,
  toLogicalModelView,
} from "./catalog"
import { getModelSnapshotDateLabel } from "./presentation"
import type { ModelConfig } from "./types"

function makeConfig(
  overrides: Partial<ModelConfig> & { id: string }
): ModelConfig {
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

function makeLineageConfig(
  id: string,
  releasedAt: string,
  overrides: Partial<ModelConfig> = {},
  lineageId: NonNullable<ModelConfig["lineageId"]> = "openai:flagship"
): ModelConfig {
  return makeConfig({
    ...overrides,
    id,
    lineageId,
    releasedAt,
  })
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

  it("fails loudly when lifecycle replacement metadata points to a missing model", () => {
    expect(() =>
      compileLogicalCatalog([
        makeConfig({
          id: "a",
          catalogStatus: "hidden",
          lifecycle: {
            status: "legacy",
            source: "editorial",
            verifiedAt: "2026-01-01",
            replacementModelId: "missing",
          },
        }),
      ])
    ).toThrow(/missing lifecycle replacement/)
  })

  it("rejects non-UTC and impossible catalog dates", () => {
    expect(() =>
      compileLogicalCatalog([
        makeConfig({ id: "impossible", releasedAt: "2026-02-30" }),
      ])
    ).toThrow(/invalid releasedAt date/)
    expect(() =>
      compileLogicalCatalog([
        makeConfig({ id: "invalid-snapshot", snapshotDate: "2026-02-30" }),
      ])
    ).toThrow(/invalid snapshotDate date/)
    expect(() =>
      compileLogicalCatalog([
        makeConfig({
          id: "ambiguous",
          lifecycle: {
            status: "active",
            source: "editorial",
            verifiedAt: "08/25/2026",
          },
        }),
      ])
    ).toThrow(/invalid lifecycle\.verifiedAt date/)
  })

  it("requires source evidence for a replacement across recommendation lanes", () => {
    const predecessor = makeLineageConfig(
      "predecessor",
      "2025-01-01",
      {
        lifecycle: {
          status: "active",
          source: "provider",
          verifiedAt: "2026-01-01",
          replacementModelId: "replacement",
        },
      },
      "openai:flagship"
    )
    const replacement = makeLineageConfig(
      "replacement",
      "2026-01-01",
      {},
      "openai:balanced"
    )

    expect(() => compileLogicalCatalog([predecessor, replacement])).toThrow(
      /crosses recommendation lanes.*without a sourceUrl/
    )

    predecessor.lifecycle = {
      ...predecessor.lifecycle!,
      sourceUrl: "https://provider.example/models/predecessor",
    }
    expect(() =>
      compileLogicalCatalog([predecessor, replacement])
    ).not.toThrow()
  })

  it("rejects lifecycle replacement cycles", () => {
    expect(() =>
      compileLogicalCatalog([
        makeConfig({
          id: "a",
          lifecycle: {
            status: "active",
            source: "editorial",
            verifiedAt: "2026-01-01",
            replacementModelId: "b",
          },
        }),
        makeConfig({
          id: "b",
          lifecycle: {
            status: "active",
            source: "editorial",
            verifiedAt: "2026-01-01",
            replacementModelId: "a",
          },
        }),
      ])
    ).toThrow(/replacement cycle a -> b -> a/)
  })

  it("rejects an invalid recommendation policy model id", () => {
    expect(() =>
      compileLogicalCatalog(
        [makeConfig({ id: "available" })],
        [
          {
            vendorId: "openai",
            currentModelIds: ["missing"],
            verifiedAt: "2026-08-25",
          },
        ]
      )
    ).toThrow(/recommendation policy.*names missing model "missing"/)
  })

  it("reports tools when a non-canonical route supports them", () => {
    const [model] = compileLogicalCatalog([
      makeConfig({ id: "direct-a", providerId: "anthropic", tools: false }),
      makeConfig({
        id: "openrouter:vendor/a",
        providerId: "openrouter",
        idKind: "wrapped",
        logicalModelId: "direct-a",
        tools: true,
      }),
    ])

    expect(toLogicalModelView(model!)).toMatchObject({
      tools: true,
      searchMode: "optional",
    })
  })

  it.each([
    [{}, "optional"],
    [{ tools: true }, "optional"],
    [{ tools: false }, "unsupported"],
    [{ tools: { search: false } }, "unsupported"],
    [{ tools: false, searchMode: "always-on" }, "always-on"],
    [{ tools: true, searchMode: "unsupported" }, "unsupported"],
  ] as const)(
    "derives route search mode from tools and explicit behavior",
    (capabilities, expected) => {
      expect(resolveModelSearchMode(capabilities)).toBe(expected)
    }
  )

  it("carries presentation from the canonical route into logical views", () => {
    const [model] = compileLogicalCatalog([
      makeConfig({
        id: "direct-a",
        name: "Full Direct A",
        shortName: "Direct A",
        providerId: "anthropic",
      }),
      makeConfig({
        id: "openrouter:vendor/a",
        name: "Wrapped Route A",
        shortName: "Wrapped A",
        providerId: "openrouter",
        idKind: "wrapped",
        logicalModelId: "direct-a",
      }),
    ])

    expect(model).toMatchObject({
      name: "Full Direct A",
      shortName: "Direct A",
    })
    expect(toLogicalModelView(model!)).toMatchObject({
      name: "Full Direct A",
      shortName: "Direct A",
    })
  })
})

describe("classifyLogicalModel", () => {
  const asOf = (date: string) => new Date(`${date}T00:00:00Z`)

  it("uses an exact vendor portfolio and defaults unlisted models to Legacy", () => {
    const models = compileLogicalCatalog(
      [makeConfig({ id: "chosen" }), makeConfig({ id: "newly-added" })],
      [
        {
          vendorId: "openai",
          currentModelIds: ["chosen"],
          verifiedAt: "2026-08-25",
        },
      ]
    )

    expect(
      classifyLogicalModel(models[0]!, models, asOf("2026-08-25"))
    ).toEqual({ classification: "current" })
    expect(
      classifyLogicalModel(models[1]!, models, asOf("2026-08-25"))
    ).toEqual({
      classification: "legacy",
      classificationReason: "not_recommended",
      classificationSource: "editorial",
      classificationEffectiveAt: "2026-08-25",
    })
    expect(
      classifyLogicalModel(models[1]!, models, asOf("2026-08-24"))
    ).toEqual({ classification: "current" })
  })

  it("does not classify a model from age alone", () => {
    const [model] = compileLogicalCatalog([
      makeConfig({ id: "old-but-current", releasedAt: "2020-01-01" }),
    ])

    expect(classifyLogicalModel(model!, [model!], asOf("2026-08-25"))).toEqual({
      classification: "current",
    })
  })

  it("does not let a newer preview supersede a stable predecessor", () => {
    const models = compileLogicalCatalog([
      makeLineageConfig("stable-a", "2025-01-01"),
      makeLineageConfig("preview-b", "2026-01-01", {
        releaseStage: "preview",
      }),
    ])

    expect(
      classifyLogicalModel(models[0]!, models, asOf("2026-08-25"))
    ).toEqual({ classification: "current" })
  })

  it("classifies a predecessor only after the stable successor grace boundary", () => {
    const models = compileLogicalCatalog([
      makeLineageConfig("stable-a", "2025-01-01"),
      makeLineageConfig("stable-b", "2026-01-01"),
    ])

    expect(
      classifyLogicalModel(models[0]!, models, asOf("2026-01-30"))
    ).toEqual({ classification: "current" })
    expect(
      classifyLogicalModel(models[0]!, models, asOf("2026-01-31"))
    ).toEqual({
      classification: "legacy",
      classificationReason: "superseded",
      successorModelId: "stable-b",
      classificationEffectiveAt: "2026-01-31",
    })
  })

  it("never recommends a successor before its release date", () => {
    const models = compileLogicalCatalog([
      makeLineageConfig("stable-a", "2025-01-01"),
      makeLineageConfig("stable-b", "2026-01-01"),
      makeLineageConfig("future-c", "2027-01-01"),
    ])

    expect(
      classifyLogicalModel(models[0]!, models, asOf("2026-03-01"))
    ).toMatchObject({ successorModelId: "stable-b" })
  })

  it("never recommends a successor with Legacy lifecycle evidence", () => {
    const models = compileLogicalCatalog([
      makeLineageConfig("stable-a", "2025-01-01"),
      makeLineageConfig("stable-b", "2026-01-01"),
      makeLineageConfig("deprecated-c", "2026-02-01", {
        lifecycle: {
          status: "deprecated",
          source: "provider",
          verifiedAt: "2026-02-15",
        },
      }),
    ])

    expect(
      classifyLogicalModel(models[0]!, models, asOf("2026-03-15"))
    ).toMatchObject({ successorModelId: "stable-b" })
  })

  it("lets explicit lifecycle evidence classify a newly released model", () => {
    const models = compileLogicalCatalog([
      makeConfig({
        id: "new-but-deprecated",
        releasedAt: "2026-08-01",
        lifecycle: {
          status: "deprecated",
          source: "provider",
          verifiedAt: "2026-08-20",
          replacementModelId: "replacement",
        },
      }),
      makeConfig({ id: "replacement", releasedAt: "2026-08-15" }),
    ])

    expect(
      classifyLogicalModel(models[0]!, models, asOf("2026-08-25"))
    ).toEqual({
      classification: "legacy",
      classificationReason: "lifecycle_deprecated",
      classificationSource: "provider",
      successorModelId: "replacement",
      classificationEffectiveAt: "2026-08-20",
    })
  })

  it("uses a dated retirement horizon without treating far-future sentinels as legacy", () => {
    const models = compileLogicalCatalog([
      makeConfig({
        id: "scheduled",
        lifecycle: {
          status: "active",
          source: "openrouter",
          verifiedAt: "2026-01-01",
          retiresAt: "2026-12-31",
        },
      }),
      makeConfig({
        id: "sentinel",
        lifecycle: {
          status: "active",
          source: "openrouter",
          verifiedAt: "2026-01-01",
          retiresAt: "2098-12-31",
        },
      }),
    ])

    expect(
      classifyLogicalModel(models[0]!, models, asOf("2026-10-02"))
    ).toMatchObject({
      classification: "legacy",
      classificationReason: "retirement_scheduled",
      classificationSource: "openrouter",
    })
    expect(
      classifyLogicalModel(models[1]!, models, asOf("2026-10-02"))
    ).toEqual({ classification: "current" })
  })
})

describe("auditLogicalModelPriorities", () => {
  it("reports a stale lane without changing its model classification", () => {
    const models = compileLogicalCatalog([
      makeLineageConfig("older-lane-head", "2025-01-01"),
      makeLineageConfig(
        "newer-provider-model",
        "2026-01-01",
        {},
        "openai:balanced"
      ),
    ])
    const asOf = new Date("2026-08-25T00:00:00Z")

    expect(classifyLogicalModel(models[0]!, models, asOf)).toEqual({
      classification: "current",
    })
    expect(auditLogicalModelPriorities(models, asOf)).toEqual([
      {
        code: "stale_recommendation_lane",
        laneId: "openai:flagship",
        vendorId: "openai",
        modelId: "older-lane-head",
        newestVendorModelId: "newer-provider-model",
        releaseGapDays: 365,
      },
    ])
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

  it("keeps Gemini's preview lifecycle out of its display name", () => {
    expect(getLogicalModel("gemini-3.1-pro-preview")).toMatchObject({
      name: "Gemini 3.1 Pro",
      releaseStage: "preview",
    })
  })

  it("merges the direct/OpenRouter duplicates into two-route models", () => {
    const sonnet = getLogicalModel("claude-sonnet-5")
    expect(sonnet?.vendorId).toBe("claude")
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

  it.each([
    {
      maker: "OpenAI",
      vendorId: "openai",
      expectedCurrentIds: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"],
    },
    {
      maker: "Anthropic",
      vendorId: "claude",
      expectedCurrentIds: [
        "claude-fable-5",
        "openrouter:anthropic/claude-opus-5",
        "claude-sonnet-5",
        "claude-haiku-4-5-20251001",
      ],
    },
    {
      maker: "Google",
      vendorId: "gemini",
      expectedCurrentIds: [
        "openrouter:google/gemini-3.5-flash-lite",
        "openrouter:google/gemini-3.7-flash",
        "gemini-3.1-pro-preview",
      ],
    },
  ])(
    "keeps exactly the curated $maker portfolio Current",
    ({ vendorId, expectedCurrentIds }) => {
      const asOf = new Date("2026-08-25T00:00:00Z")
      const currentIds = LOGICAL_MODELS.filter(
        (model) =>
          model.vendorId === vendorId &&
          model.catalogStatus === "visible" &&
          classifyLogicalModel(model, LOGICAL_MODELS, asOf).classification ===
            "current"
      )
        .map((model) => model.id)
        .toSorted()

      expect(currentIds).toEqual(expectedCurrentIds.toSorted())
    }
  )

  it.each([
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "mistral-medium-3-5",
    "mistral-small-2603",
    "ministral-14b-2512",
    "ministral-8b-2512",
    "ministral-3b-2512",
    "openrouter:deepseek/deepseek-v4-flash-vision-exp",
    "openrouter:qwen/qwen3.8-2.4t-a95b",
    "openrouter:qwen/qwen3.8-max",
    "openrouter:qwen/qwen3.8-27b",
    "openrouter:qwen/qwen3.7-flash",
    "openrouter:deepseek/deepseek-v3.2",
    "openrouter:google/gemini-3.7-flash",
    "openrouter:minimax/minimax-m2.7",
    "openrouter:inclusionai/ling-3.0-flash",
    "openrouter:moonshotai/kimi-k2.7-code",
    "openrouter:moonshotai/kimi-k3",
    "openrouter:openai/gpt-5.5-pro",
    "openrouter:z-ai/glm-5v-turbo",
    "openrouter:x-ai/grok-4.6",
  ])("keeps reference-catalog route %s visible", (modelId) => {
    expect(getLogicalModel(modelId)?.catalogStatus).toBe("visible")
  })

  it.each([
    ["claude-sonnet-4-6", "openrouter:anthropic/claude-sonnet-4.6"],
    ["gpt-4.1", "openrouter:openai/gpt-4.1"],
    ["gemini-2.5-pro", "openrouter:google/gemini-2.5-pro"],
  ])(
    "adds the reference route to direct logical model %s",
    (modelId, routeId) => {
      const model = getLogicalModel(modelId)
      expect(model?.catalogStatus).toBe("visible")
      expect(model?.routes.map((route) => route.id)).toContain(routeId)
    }
  )

  it("reports optional search when every route can provide it", () => {
    const sonnet = getLogicalModel("claude-sonnet-5")!

    expect(
      sonnet.routes.every(
        (route) => resolveModelSearchMode(route.config) === "optional"
      )
    ).toBe(true)
    expect(toLogicalModelView(sonnet).searchMode).toBe("optional")
  })

  it("unions effort levels across routes in canonical order (ADR-0026)", () => {
    // Sonnet 4.6 supports low|medium|high|max (Anthropic models API,
    // 2026-08-26 — no "xhigh" on the 4.6 generation, no "minimal" anywhere).
    // Its OpenRouter wrap mirrors that minus the wire-inexpressible "max";
    // the view menu is the ordered union of both routes' real sets.
    const sonnet46 = getLogicalModel("claude-sonnet-4-6")!
    expect(toLogicalModelView(sonnet46).effortLevels).toEqual([
      "low",
      "medium",
      "high",
      "max",
    ])

    // A model with no effort-capable route omits the field entirely.
    const gpt41 = getLogicalModel("gpt-4.1")!
    expect(toLogicalModelView(gpt41).effortLevels).toBeUndefined()
  })

  it("every effort-capable route declares a default within its levels (ADR-0026)", () => {
    // The effort menu has no separate "Default" row: the default level reads
    // as selected and re-picking it clears the override. A route offering
    // levels without a default (or a default outside them) would leave the
    // user no path back to the no-override state.
    for (const model of LOGICAL_MODELS) {
      for (const route of model.routes) {
        const { effortLevels, defaultEffort } = route.config
        if (!effortLevels || effortLevels.length === 0) continue
        expect
          .soft(defaultEffort, `route ${route.id} declares no defaultEffort`)
          .toBeDefined()
        if (defaultEffort !== undefined) {
          expect
            .soft(
              effortLevels,
              `route ${route.id} defaultEffort outside effortLevels`
            )
            .toContain(defaultEffort)
        }
      }
    }
  })

  it("every logical view with an effort menu carries a default in it (ADR-0026)", () => {
    // The menu consumes the VIEW, whose default aggregates across routes —
    // the canonical route alone may have no effort knob (e.g. Gemini 2.5)
    // while a wrapped route supplies the level union.
    for (const model of LOGICAL_MODELS) {
      const view = toLogicalModelView(model)
      if (!view.effortLevels || view.effortLevels.length === 0) continue
      expect
        .soft(view.defaultEffort, `view ${model.id} has a menu but no default`)
        .toBeDefined()
      if (view.defaultEffort !== undefined) {
        expect
          .soft(
            view.effortLevels,
            `view ${model.id} defaultEffort outside its menu`
          )
          .toContain(view.defaultEffort)
      }
    }
  })

  it.each([
    ["gpt-5.6-luna", "GPT-5.6 Luna", "5.6 Luna"],
    ["gpt-5.5", "GPT-5.5", "5.5"],
    ["gpt-5.4-mini", "GPT-5.4 Mini", "5.4 Mini"],
    ["openrouter:openai/gpt-5.5-pro", "GPT-5.5 Pro", "5.5 Pro"],
    ["gemini-3.5-flash", "Gemini 3.5 Flash", "3.5 Flash"],
    ["openrouter:google/gemini-3.7-flash", "Gemini 3.7 Flash", "3.7 Flash"],
    ["openrouter:deepseek/deepseek-v4-pro-0813", "DeepSeek V4 Pro", "V4 Pro"],
    ["openrouter:moonshotai/kimi-k3", "Kimi K3", "K3"],
    ["openrouter:inclusionai/ling-3.0-flash", "Ling 3.0 Flash", "3.0 Flash"],
    ["openrouter:xiaomi/mimo-v2.5", "MiMo-V2.5", "V2.5"],
    [
      "openrouter:meta-llama/llama-4-maverick",
      "Llama 4 Maverick",
      "4 Maverick",
    ],
    ["openrouter:qwen/qwen3-coder", "Qwen3-Coder", "3-Coder"],
    ["openrouter:minimax/minimax-m3", "MiniMax M3", "M3"],
    ["openrouter:z-ai/glm-5.2", "GLM-5.2", "5.2"],
    ["claude-sonnet-5", "Claude Sonnet 5", "Sonnet 5"],
    ["sonar", "Perplexity Sonar", "Sonar"],
    [
      "sonar-reasoning-pro",
      "Perplexity Sonar Reasoning Pro",
      "Sonar Reasoning Pro",
    ],
    ["sonar-pro", "Perplexity Sonar Pro", "Sonar Pro"],
    [
      "sonar-deep-research",
      "Perplexity Sonar Deep Research",
      "Sonar Deep Research",
    ],
  ])("exposes full and compact names for %s", (modelId, name, shortName) => {
    const model = getLogicalModel(modelId)

    expect(model).toMatchObject({ name, shortName })
    expect(toLogicalModelView(model!)).toMatchObject({ name, shortName })
  })

  it.each([
    ["GPT", "GPT-", /gpt/i],
    ["Gemini", "Gemini ", /gemini/i],
    ["DeepSeek", "DeepSeek ", /deepseek/i],
    ["Kimi", "Kimi ", /kimi/i],
    ["Ling", "Ling ", /ling/i],
    ["MiMo", "MiMo-", /mimo/i],
    ["Llama", "Llama ", /llama/i],
    ["Qwen", "Qwen", /qwen/i],
    ["MiniMax", "MiniMax ", /minimax/i],
    ["GLM", "GLM-", /glm/i],
  ])(
    "keeps every %s compact name free of its redundant prefix",
    (_family, fullNamePrefix, redundantPrefix) => {
      const models = LOGICAL_MODELS.filter((model) =>
        model.name.startsWith(fullNamePrefix)
      )

      expect(models).not.toHaveLength(0)
      for (const model of models) {
        expect.soft(model.shortName, model.id).toBeTruthy()
        expect.soft(model.shortName, model.id).not.toMatch(redundantPrefix)
      }
    }
  )

  it.each([
    ["openrouter:google/gemini-3-flash-preview", "Gemini 3 Flash"],
    [
      "openrouter:deepseek/deepseek-v4-flash-vision-exp",
      "DeepSeek V4 Flash Vision",
    ],
    ["openrouter:qwen/qwen3.8-2.4t-a95b", "Qwen3.8-2.4T"],
    ["openrouter:qwen/qwen3-coder", "Qwen3-Coder"],
    ["openrouter:qwen/qwen3-235b-a22b-2507", "Qwen3-235B"],
    ["openrouter:qwen/qwen3.6-35b-a3b", "Qwen3.6-35B"],
  ])("keeps route metadata out of the %s label", (modelId, name) => {
    expect(toLogicalModelView(getLogicalModel(modelId)!)).toMatchObject({
      name,
    })
  })

  it.each([
    ["openrouter:deepseek/deepseek-chat-v3-0324", "March 2025"],
    ["openrouter:deepseek/deepseek-r1-0528", "May 2025"],
    ["openrouter:deepseek/deepseek-v4-pro", "April 2026"],
    ["openrouter:deepseek/deepseek-v4-flash", "April 2026"],
    ["openrouter:moonshotai/kimi-k2", "July 2025"],
    ["openrouter:moonshotai/kimi-k2-0905", "September 2025"],
    ["openrouter:qwen/qwen3-235b-a22b-2507", "July 2025"],
    ["mistral-small-2506", "June 2025"],
    ["claude-sonnet-4-5-20250929", "September 2025"],
  ])("classifies older snapshot %s as Legacy", (modelId, dateLabel) => {
    const model = getLogicalModel(modelId)!

    expect(getModelSnapshotDateLabel(model.routes[0]!.config)).toBe(dateLabel)
    expect(model.name).not.toMatch(/\b\d{4}\b|\(\d{4}\)/)
    expect(
      classifyLogicalModel(
        model,
        LOGICAL_MODELS,
        new Date("2026-08-25T00:00:00Z")
      ).classification
    ).toBe("legacy")
  })

  it.each([
    "openrouter:deepseek/deepseek-v4-flash-0731",
    "openrouter:deepseek/deepseek-v4-pro-0813",
  ])("keeps latest snapshot %s Current without a dated label", (modelId) => {
    const model = getLogicalModel(modelId)!

    expect(
      classifyLogicalModel(
        model,
        LOGICAL_MODELS,
        new Date("2026-08-25T00:00:00Z")
      ).classification
    ).toBe("current")
    expect(model.name).not.toMatch(/\b\d{4}\b|\(\d{4}\)/)
  })

  it("keeps raw route lifecycle metadata on the logical model view", () => {
    const model = getLogicalModel("openrouter:deepseek/deepseek-v4-pro")!
    const view = toLogicalModelView(model, new Date("2026-08-25T00:00:00Z"))

    expect(view.routes[0]?.lifecycle).toEqual(model.routes[0]?.config.lifecycle)
  })
})

describe("resolveModelSelection", () => {
  it("resolves a merged wrapped id to its logical model with a route hint", () => {
    expect(
      resolveModelSelection("openrouter:anthropic/claude-sonnet-5")
    ).toEqual({
      modelId: "claude-sonnet-5",
      legacyRouteHint: "openrouter:anthropic/claude-sonnet-5",
    })
  })

  it("keeps aliases and successions resolving first", () => {
    // Alias chain: deepseek-r1 → delisted free R1 → live GPT-OSS route.
    expect(resolveModelSelection("deepseek-r1")).toEqual({
      modelId: "openrouter:openai/gpt-oss-120b",
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
