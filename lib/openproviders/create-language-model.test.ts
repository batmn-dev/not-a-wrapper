import { getModelInfo } from "@/lib/models"
import { describe, expect, it } from "vitest"
import { createLanguageModel } from "./create-language-model"

describe("createLanguageModel", () => {
  it("builds the already-resolved catalog route", () => {
    const modelConfig = getModelInfo("gpt-5-mini")
    expect(modelConfig).toBeDefined()

    expect(createLanguageModel(modelConfig!, "test-api-key").modelId).toBe(
      "gpt-5-mini"
    )
  })

  it("uses the resolved route provider instead of deriving one from its id", () => {
    const route = getModelInfo("openrouter:openai/gpt-oss-120b")
    expect(route).toBeDefined()

    const model = createLanguageModel(route!, "test-api-key") as unknown as {
      config?: { compatibility?: string }
      modelId?: string
      provider?: string
    }

    expect(model.provider).toBe("openrouter")
    expect(model.modelId).toBe("openai/gpt-oss-120b")
    expect(model.config?.compatibility).toBe("strict")
  })

  it("feeds the catalog's construction reasoning settings into the model", () => {
    const gptOss = getModelInfo("openrouter:openai/gpt-oss-120b")
    expect(gptOss?.reasoning).toEqual({ effort: "medium" })

    const configured = createLanguageModel(gptOss!, "test-api-key") as {
      settings?: { reasoning?: unknown }
    }
    expect(configured.settings?.reasoning).toEqual({ effort: "medium" })
  })
})
