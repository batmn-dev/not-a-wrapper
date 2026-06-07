import { describe, expect, it } from "vitest"
import { getModelInfo } from "@/lib/models"
import { createLanguageModel } from "./create-language-model"

describe("createLanguageModel", () => {
  it("accepts catalog model configs and resolves legacy aliases", () => {
    const modelConfig = getModelInfo("gpt-5-mini")
    expect(modelConfig).toBeDefined()

    expect(createLanguageModel(modelConfig!, "test-api-key").modelId).toBe(
      "gpt-5-mini"
    )
    expect(createLanguageModel("o4-mini", "test-api-key").modelId).toBe(
      "gpt-5-mini"
    )
    expect(createLanguageModel("deepseek-r1", "test-api-key").modelId).toBe(
      "deepseek/deepseek-r1:free"
    )
  })

  it("uses OpenRouter runtime behavior for prefixed model ids", () => {
    const model = createLanguageModel(
      "openrouter:deepseek/deepseek-r1:free",
      "test-api-key"
    ) as unknown as {
      config?: { compatibility?: string }
      modelId?: string
      provider?: string
    }

    expect(model.provider).toBe("openrouter")
    expect(model.modelId).toBe("deepseek/deepseek-r1:free")
    expect(model.config?.compatibility).toBe("strict")
  })
})
