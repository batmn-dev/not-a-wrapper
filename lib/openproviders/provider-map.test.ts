import * as modelIdMigration from "@/lib/models/model-id-migration"
import { afterEach, describe, expect, it, vi } from "vitest"
import { getAllModels, getModelInfo } from "../models"
import { getProviderForModel, getProviderForResolvedModel } from "./provider-map"

describe("getProviderForModel", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("resolves migrated legacy IDs before provider lookup", () => {
    expect(getProviderForModel("deepseek-r1")).toBe("openrouter")
    expect(getProviderForModel("codestral-latest")).toBe("mistral")
    expect(getProviderForModel("mistral-large-latest")).toBe("mistral")
    expect(getProviderForModel("mistral-small-2503")).toBe("mistral")
    expect(getProviderForModel("sonar-reasoning")).toBe("perplexity")
    expect(getProviderForModel("grok-4")).toBe("xai")
    expect(getProviderForModel("gpt-5.2")).toBe("openai")
    expect(getProviderForModel("claude-sonnet-4-5")).toBe("anthropic")
  })

  it("keeps wrapped OpenRouter IDs on the OpenRouter provider path", () => {
    expect(
      getProviderForModel("openrouter:google/gemini-2.0-flash-lite-001")
    ).toBe("openrouter")
    expect(getProviderForModel("openrouter:openai/gpt-4.1")).toBe("openrouter")
  })

  it("routes resolved IDs without applying migration rules again", () => {
    const resolveModelIdSpy = vi.spyOn(modelIdMigration, "resolveModelId")

    expect(
      getProviderForResolvedModel("openrouter:openai/gpt-oss-120b:free")
    ).toBe("openrouter")
    expect(resolveModelIdSpy).not.toHaveBeenCalled()

    expect(getProviderForModel("mistral-small-2503")).toBe("mistral")
    expect(resolveModelIdSpy).toHaveBeenCalledWith("mistral-small-2503")
  })

  it("routes canonical and fast non-reasoning Grok IDs", () => {
    expect(getProviderForModel("grok-4-0709")).toBe("xai")
    expect(getProviderForModel("grok-4-1-fast-non-reasoning")).toBe("xai")
  })

  it("falls back for uncatalogued legacy IDs that still need routing", () => {
    expect(getModelInfo("gpt-5.1-thinking")).toBeUndefined()
    expect(getModelInfo("gemini-1.5-pro-latest")).toBeUndefined()
    expect(getModelInfo("grok-2")).toBeUndefined()

    expect(getProviderForModel("gpt-5.1-thinking")).toBe("openai")
    expect(getProviderForModel("gemini-1.5-pro-latest")).toBe("google")
    expect(getProviderForModel("grok-2")).toBe("xai")
  })

  it("keeps model catalog IDs routable through provider map", async () => {
    const models = await getAllModels()

    for (const model of models) {
      expect(getProviderForModel(model.id)).toBe(model.providerId)
    }
  })
})
