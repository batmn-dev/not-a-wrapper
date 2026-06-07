import { describe, expect, it } from "vitest"
import { getModelInfo } from "@/lib/models"
import { createLanguageModel } from "./create-language-model"
import { createProviderLanguageModel } from "./model-factory"

describe("createLanguageModel", () => {
  it("creates AI SDK language models for representative providers", () => {
    const cases = [
      {
        modelId: "gpt-5-mini",
        provider: "openai.responses",
        runtimeModelId: "gpt-5-mini",
      },
      {
        modelId: "claude-haiku-4-5-20251001",
        provider: "anthropic.messages",
        runtimeModelId: "claude-haiku-4-5-20251001",
      },
      {
        modelId: "gemini-2.5-flash-lite",
        provider: "google.generative-ai",
        runtimeModelId: "gemini-2.5-flash-lite",
      },
      {
        modelId: "codestral-2508",
        provider: "mistral.chat",
        runtimeModelId: "codestral-2508",
      },
      {
        modelId: "sonar",
        provider: "perplexity",
        runtimeModelId: "sonar",
      },
      {
        modelId: "grok-code-fast-1",
        provider: "xai.chat",
        runtimeModelId: "grok-code-fast-1",
      },
      {
        modelId: "openrouter:deepseek/deepseek-r1:free",
        provider: "openrouter",
        runtimeModelId: "deepseek/deepseek-r1:free",
      },
    ]

    for (const testCase of cases) {
      const model = createLanguageModel(testCase.modelId, "test-api-key")

      expect(model.specificationVersion).toBe("v3")
      expect(model.provider).toBe(testCase.provider)
      expect(model.modelId).toBe(testCase.runtimeModelId)
    }
  })

  it("accepts catalog model configs and resolves legacy aliases", () => {
    const modelConfig = getModelInfo("gpt-5-mini")
    expect(modelConfig).toBeDefined()

    expect(createLanguageModel(modelConfig!, "test-api-key").modelId).toBe(
      "gpt-5-mini"
    )
    expect(createLanguageModel("deepseek-r1", "test-api-key").modelId).toBe(
      "deepseek/deepseek-r1:free"
    )
  })

  it("resolves aliases at the provider factory boundary", () => {
    expect(
      createProviderLanguageModel("deepseek-r1", "test-api-key").modelId
    ).toBe("deepseek/deepseek-r1:free")
    expect(createProviderLanguageModel("o4-mini", "test-api-key").modelId).toBe(
      "gpt-5-mini"
    )
  })

  it("uses strict OpenRouter compatibility for custom OpenRouter providers", () => {
    const model = createProviderLanguageModel(
      "openrouter:deepseek/deepseek-r1:free",
      "test-api-key"
    ) as unknown as { config?: { compatibility?: string } }

    expect(model.config?.compatibility).toBe("strict")
  })
})
