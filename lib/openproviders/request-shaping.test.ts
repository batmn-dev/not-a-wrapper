import { ANTHROPIC_BETA_HEADERS } from "@/lib/config"
import { getAllModels } from "@/lib/models"
import type { ModelConfig } from "@/lib/models/types"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  resolveAppliedReasoningEffort,
  shapeRequest,
  type RequestShapingContext,
} from "./request-shaping"

function makeModel(overrides: Partial<ModelConfig>): ModelConfig {
  return {
    id: "test-model",
    name: "Test Model",
    provider: "Test",
    providerId: "openai",
    baseProviderId: "openai",
    catalogStatus: "visible",
    idKind: "stable",
    ...overrides,
  } as ModelConfig
}

const NO_TOOLS: RequestShapingContext = {
  searchToolsActive: false,
  hasTools: false,
}

describe("shapeRequest provider options", () => {
  const cases: Array<{
    name: string
    model: Partial<ModelConfig>
    ctx: RequestShapingContext
    expected: Record<string, unknown>
  }> = [
    {
      name: "anthropic adaptive without search uses adaptive thinking",
      model: {
        providerId: "anthropic",
        reasoningText: true,
        thinkingMode: "adaptive",
      },
      ctx: { searchToolsActive: false, hasTools: true },
      expected: { anthropic: { thinking: { type: "adaptive" } } },
    },
    {
      // The pause_turn downgrade is catalog-driven: only 4.6-generation
      // models (where budget_tokens is deprecated but functional) carry
      // searchThinkingDowngrade.
      name: "flagged anthropic adaptive with search downgrades to enabled (pause_turn workaround)",
      model: {
        providerId: "anthropic",
        reasoningText: true,
        thinkingMode: "adaptive",
        searchThinkingDowngrade: true,
      },
      ctx: { searchToolsActive: true, hasTools: true },
      expected: {
        anthropic: { thinking: { type: "enabled", budgetTokens: 10000 } },
      },
    },
    {
      // Opus 4.8/Sonnet 5/Fable 5: budget_tokens is removed upstream (HTTP
      // 400), so unflagged adaptive models stay adaptive even with search
      // tools active.
      name: "unflagged anthropic adaptive keeps adaptive thinking with search active",
      model: {
        providerId: "anthropic",
        reasoningText: true,
        thinkingMode: "adaptive",
      },
      ctx: { searchToolsActive: true, hasTools: true },
      expected: { anthropic: { thinking: { type: "adaptive" } } },
    },
    {
      // The flag without active search tools changes nothing.
      name: "flagged anthropic adaptive without search keeps adaptive thinking",
      model: {
        providerId: "anthropic",
        reasoningText: true,
        thinkingMode: "adaptive",
        searchThinkingDowngrade: true,
      },
      ctx: { searchToolsActive: false, hasTools: true },
      expected: { anthropic: { thinking: { type: "adaptive" } } },
    },
    {
      name: "anthropic fixed-budget model uses its declared thinkingBudget",
      model: {
        providerId: "anthropic",
        reasoningText: true,
        thinkingBudget: 12000,
      },
      ctx: NO_TOOLS,
      expected: {
        anthropic: { thinking: { type: "enabled", budgetTokens: 12000 } },
      },
    },
    {
      name: "anthropic without declared budget falls back to 10000",
      model: { providerId: "anthropic", reasoningText: true },
      ctx: NO_TOOLS,
      expected: {
        anthropic: { thinking: { type: "enabled", budgetTokens: 10000 } },
      },
    },
    {
      // The pause_turn downgrade is adaptive-only: a non-adaptive (fixed-budget)
      // model keeps its declared budget even when search tools are active.
      name: "anthropic fixed-budget model ignores active search (downgrade is adaptive-only)",
      model: {
        providerId: "anthropic",
        reasoningText: true,
        thinkingBudget: 12000,
      },
      ctx: { searchToolsActive: true, hasTools: true },
      expected: {
        anthropic: { thinking: { type: "enabled", budgetTokens: 12000 } },
      },
    },
    {
      name: "google reasoning model includes thoughts",
      model: { providerId: "google", reasoningText: true },
      ctx: NO_TOOLS,
      expected: { google: { thinkingConfig: { includeThoughts: true } } },
    },
    {
      name: "openai reasoning model gets medium effort and auto summary",
      model: { providerId: "openai", reasoningText: true },
      ctx: NO_TOOLS,
      expected: {
        openai: { reasoningEffort: "medium", reasoningSummary: "auto" },
      },
    },
    {
      // xAI accepts reasoning_effort only on grok-3-mini ("low" | "high");
      // the cataloged Grok 4-family models reject it, so xai sends none.
      name: "xai reasoning model gets no provider options",
      model: { providerId: "xai", reasoningText: true },
      ctx: NO_TOOLS,
      expected: {},
    },
    {
      name: "model without reasoningText gets no options",
      model: { providerId: "anthropic", thinkingBudget: 12000 },
      ctx: NO_TOOLS,
      expected: {},
    },
    {
      name: "reasoning model on a provider without thinking options gets none",
      model: { providerId: "mistral", reasoningText: true },
      ctx: NO_TOOLS,
      expected: {},
    },
  ]

  it.each(cases)("$name", ({ model, ctx, expected }) => {
    const { providerOptions } = shapeRequest(makeModel(model), ctx)
    expect(providerOptions).toEqual(expected)
  })
})

describe("per-turn reasoning effort (ADR-0026)", () => {
  it("resolves applied effort: pass-through, clamp, platform, effortless", () => {
    const levels = makeModel({
      effortLevels: ["low", "medium", "high", "max"],
    })
    const platform = { platformFunded: true }
    const byok = { platformFunded: false }

    expect(resolveAppliedReasoningEffort(levels, "high", byok)).toBe("high")
    // "xhigh" is not offered — clamps to the nearest level in canonical order.
    expect(resolveAppliedReasoningEffort(levels, "xhigh", byok)).toBe("high")
    expect(resolveAppliedReasoningEffort(levels, "none", byok)).toBe("low")
    // Platform-funded turns run at Default (ADR-0021 reservation estimate).
    expect(resolveAppliedReasoningEffort(levels, "max", platform))
      .toBeUndefined()
    expect(resolveAppliedReasoningEffort(levels, undefined, byok))
      .toBeUndefined()
    expect(resolveAppliedReasoningEffort(makeModel({}), "high", byok))
      .toBeUndefined()
  })

  it("maps applied effort onto each provider's wire shape", () => {
    const ctx: RequestShapingContext = {
      ...NO_TOOLS,
      reasoningEffort: "xhigh",
    }
    expect(
      shapeRequest(
        makeModel({
          providerId: "anthropic",
          reasoningText: true,
          thinkingMode: "adaptive",
        }),
        ctx
      ).providerOptions
    ).toEqual({
      anthropic: { thinking: { type: "adaptive" }, effort: "xhigh" },
    })
    expect(
      shapeRequest(makeModel({ providerId: "openai", reasoningText: true }), {
        ...NO_TOOLS,
        reasoningEffort: "low",
      }).providerOptions
    ).toEqual({
      openai: { reasoningEffort: "low", reasoningSummary: "auto" },
    })
    expect(
      shapeRequest(makeModel({ providerId: "google", reasoningText: true }), {
        ...NO_TOOLS,
        reasoningEffort: "high",
      }).providerOptions
    ).toEqual({
      google: {
        thinkingConfig: { includeThoughts: true, thinkingLevel: "high" },
      },
    })
    expect(
      shapeRequest(makeModel({ providerId: "xai", reasoningText: true }), {
        ...NO_TOOLS,
        reasoningEffort: "low",
      }).providerOptions
    ).toEqual({ xai: { reasoningEffort: "low" } })
    // Without an applied effort, xai sends nothing (Grok 4 rejects the param).
    expect(
      shapeRequest(
        makeModel({ providerId: "xai", reasoningText: true }),
        NO_TOOLS
      ).providerOptions
    ).toEqual({})
  })
})

describe("shapeRequest headers", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("sets the token-efficient beta header for anthropic with tools", () => {
    const { headers } = shapeRequest(
      makeModel({ providerId: "anthropic", reasoningText: true }),
      { searchToolsActive: false, hasTools: true }
    )
    expect(headers).toEqual({
      "anthropic-beta": ANTHROPIC_BETA_HEADERS.tokenEfficient,
    })
  })

  it("sends no header for anthropic without tools", () => {
    const { headers } = shapeRequest(
      makeModel({ providerId: "anthropic", reasoningText: true }),
      NO_TOOLS
    )
    expect(headers).toEqual({})
  })

  it("sets the header for anthropic with tools regardless of reasoningText", () => {
    // The token-efficient beta gates on provider + tools + env only — never on
    // reasoningText. A non-reasoning anthropic model with tools still gets it.
    const { headers } = shapeRequest(
      makeModel({ providerId: "anthropic", reasoningText: false }),
      { searchToolsActive: false, hasTools: true }
    )
    expect(headers).toEqual({
      "anthropic-beta": ANTHROPIC_BETA_HEADERS.tokenEfficient,
    })
  })

  it("sends no header for non-anthropic providers with tools", () => {
    const { headers } = shapeRequest(
      makeModel({ providerId: "openai", reasoningText: true }),
      { searchToolsActive: false, hasTools: true }
    )
    expect(headers).toEqual({})
  })

  it("respects the ANTHROPIC_TOKEN_EFFICIENT_TOOLS=false kill switch", () => {
    vi.stubEnv("ANTHROPIC_TOKEN_EFFICIENT_TOOLS", "false")
    const { headers } = shapeRequest(
      makeModel({ providerId: "anthropic", reasoningText: true }),
      { searchToolsActive: false, hasTools: true }
    )
    expect(headers).toEqual({})
  })
})

describe("catalog contract for Request shaping", () => {
  // Request shaping resolves the fixed thinking budget from the model's
  // `thinkingBudget` field, replacing the old model-id string matching
  // (`includes("opus"/"sonnet"/"haiku")`). That string match was an implicit
  // safety net: a non-adaptive anthropic reasoning model with no declared
  // budget now silently falls back to DEFAULT_THINKING_BUDGET_TOKENS (10000).
  // Pin the invariant so a future model can't lose its budget by omission.
  it("every non-adaptive anthropic reasoning model declares thinkingBudget", async () => {
    const offenders = (await getAllModels()).filter(
      (m) =>
        m.providerId === "anthropic" &&
        m.reasoningText === true &&
        m.thinkingMode !== "adaptive" &&
        m.thinkingBudget === undefined
    )

    expect(
      offenders.map((m) => m.id),
      "non-adaptive anthropic reasoning models must set an explicit thinkingBudget"
    ).toEqual([])
  })
})
