import { describe, expect, it } from "vitest"
import { getProviderStrategy } from "./provider-strategy"

const SEARCH_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "xai",
  "openrouter",
] as const
const NON_SEARCH_PROVIDERS = ["mistral", "perplexity"] as const

describe("provider strategy registry", () => {
  it.each(SEARCH_PROVIDERS)(
    "%s exposes a native search tool on both BYOK and env paths",
    (provider) => {
      const strategy = getProviderStrategy(provider)
      expect(strategy.searchToolMetadata?.openWorld).toBe(true)
      expect(strategy.searchToolMetadata?.readOnly).toBe(true)
      // BYOK instance and env-fallback instance both surface the tool.
      expect(strategy.instance("byok-key").searchTool()).toBeDefined()
      expect(strategy.instance().searchTool()).toBeDefined()
    }
  )

  it.each(NON_SEARCH_PROVIDERS)(
    "%s exposes no native search tool",
    (provider) => {
      const strategy = getProviderStrategy(provider)
      expect(strategy.searchToolMetadata).toBeUndefined()
      expect(strategy.instance("byok-key").searchTool()).toBeUndefined()
    }
  )

  // The 8-way SDK-factory branch + the BYOK-vs-default-singleton selection were
  // previously untested; one matrix now covers both construction paths.
  it.each([
    ["openai", "gpt-5-mini"],
    ["anthropic", "claude-opus-4-6"],
    ["google", "gemini-2.5-pro"],
    ["xai", "grok-4"],
    ["mistral", "mistral-large-latest"],
    ["perplexity", "sonar-pro"],
  ] as const)("builds %s models on the BYOK and env paths", (provider, id) => {
    const strategy = getProviderStrategy(provider)
    const byok = strategy.instance("byok-key").languageModel(id) as {
      modelId?: string
    }
    const env = strategy.instance().languageModel(id) as { modelId?: string }
    expect(byok.modelId).toBe(id)
    expect(env.modelId).toBe(id)
  })

  it("strips the openrouter: prefix when building the model", () => {
    const model = getProviderStrategy("openrouter")
      .instance("byok-key")
      .languageModel("openrouter:openai/gpt-oss-120b") as {
      modelId?: string
      provider?: string
      specificationVersion?: string
    }
    expect(model.provider).toBe("openrouter")
    expect(model.modelId).toBe("openai/gpt-oss-120b")
    expect(model.specificationVersion).toBe("v4")
  })

  it("uses OpenRouter's automatic server-side web-search tool", () => {
    const tool = getProviderStrategy("openrouter")
      .instance("byok-key")
      .searchTool()

    expect(tool).toMatchObject({
      id: "openrouter.web_search",
      args: { engine: "auto" },
    })
  })

  // Construction settings: the OpenRouter strategy maps the neutral shape to
  // its `.chat(id, settings)` vocabulary; absent settings must construct
  // exactly the pre-seam model; other strategies ignore the argument.
  describe("construction settings", () => {
    const OPENROUTER_ID = "openrouter:openai/gpt-oss-120b"
    type OpenRouterModelShape = {
      modelId?: string
      settings?: { reasoning?: unknown }
    }

    it("maps reasoning effort and token budgets onto OpenRouter chat settings", () => {
      const instance = getProviderStrategy("openrouter").instance("byok-key")
      const effortModel = instance.languageModel(OPENROUTER_ID, {
        reasoning: { effort: "medium" },
      }) as OpenRouterModelShape
      expect(effortModel.settings?.reasoning).toEqual({ effort: "medium" })

      const budgetModel = instance.languageModel(OPENROUTER_ID, {
        reasoning: { maxTokens: 2048 },
      }) as OpenRouterModelShape
      expect(budgetModel.settings?.reasoning).toEqual({ max_tokens: 2048 })
    })

    it("constructs OpenRouter models without reasoning when settings are absent", () => {
      const model = getProviderStrategy("openrouter")
        .instance("byok-key")
        .languageModel(OPENROUTER_ID) as OpenRouterModelShape
      expect(model.settings?.reasoning).toBeUndefined()
    })

    it("leaves strategies without construction knobs unaffected", () => {
      const model = getProviderStrategy("openai")
        .instance("byok-key")
        .languageModel("gpt-5-mini", { reasoning: { effort: "high" } }) as {
        modelId?: string
      }
      expect(model.modelId).toBe("gpt-5-mini")
    })
  })
})
