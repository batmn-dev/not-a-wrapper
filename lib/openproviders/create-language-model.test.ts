import { getModelInfo } from "@/lib/models"
import { describe, expect, it } from "vitest"
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
      "openai/gpt-oss-120b:free"
    )
  })

  it("uses OpenRouter runtime behavior for prefixed model ids", () => {
    const model = createLanguageModel(
      "openrouter:openai/gpt-oss-120b:free",
      "test-api-key"
    ) as unknown as {
      config?: { compatibility?: string }
      modelId?: string
      provider?: string
    }

    expect(model.provider).toBe("openrouter")
    expect(model.modelId).toBe("openai/gpt-oss-120b:free")
    expect(model.config?.compatibility).toBe("strict")
  })

  it("feeds the catalog's construction reasoning settings into the model", () => {
    const gptOss = getModelInfo("openrouter:openai/gpt-oss-120b:free")
    expect(gptOss?.reasoning).toEqual({ effort: "medium" })

    const configured = createLanguageModel(gptOss!, "test-api-key") as {
      settings?: { reasoning?: unknown }
    }
    expect(configured.settings?.reasoning).toEqual({ effort: "medium" })

    // Bare string ids carry no catalog config — prior construction unchanged.
    const bare = createLanguageModel(
      "openrouter:openai/gpt-oss-120b:free",
      "test-api-key"
    ) as { settings?: { reasoning?: unknown } }
    expect(bare.settings?.reasoning).toBeUndefined()
  })
})
