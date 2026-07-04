import { describe, expect, it } from "vitest"
import { getProviderStrategy } from "./provider-strategy"
import type { Provider } from "./types"

const SEARCH_PROVIDERS = ["openai", "anthropic", "google", "xai"] as const
const NON_SEARCH_PROVIDERS = ["mistral", "perplexity", "openrouter"] as const

const ENV_VARS: Record<Provider, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  xai: "XAI_API_KEY",
  mistral: "MISTRAL_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
}

describe("provider strategy registry", () => {
  it.each(Object.keys(ENV_VARS) as Provider[])(
    "exposes id and platform env-var name for %s",
    (provider) => {
      const strategy = getProviderStrategy(provider)
      expect(strategy.id).toBe(provider)
      expect(strategy.envVarName).toBe(ENV_VARS[provider])
    }
  )

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
      .languageModel("openrouter:openai/gpt-oss-120b:free") as {
      modelId?: string
      provider?: string
    }
    expect(model.provider).toBe("openrouter")
    expect(model.modelId).toBe("openai/gpt-oss-120b:free")
  })
})
