import { describe, expect, it } from "vitest"
import {
  getAllModels,
  getLogicalModelInfo,
  getVisibleLogicalModelViews,
  getVisibleModels,
} from "./index"

describe("model catalog exposure", () => {
  it("keeps the visible catalog smaller than the full routable registry", async () => {
    const [allModels, visibleModels] = await Promise.all([
      getAllModels(),
      getVisibleModels(),
    ])

    expect(visibleModels.length).toBeLessThan(allModels.length)
    expect(
      visibleModels.every((model) => model.catalogStatus === "visible")
    ).toBe(true)
  })

  it("exposes derived priority without changing selector visibility", () => {
    const models = getVisibleLogicalModelViews(new Date("2026-08-25T00:00:00Z"))

    expect(models.find((model) => model.id === "gpt-5.6-sol")).toMatchObject({
      classification: "current",
    })
    expect(models.find((model) => model.id === "gpt-5.5")).toMatchObject({
      classification: "legacy",
      classificationReason: "not_recommended",
      classificationSource: "editorial",
      classificationEffectiveAt: "2026-08-25",
    })
    expect(models.some((model) => model.id === "grok-code-fast-1")).toBe(false)
  })

  it("flags platform access only on the free-listed logical models", () => {
    const models = getVisibleLogicalModelViews()

    expect(models.find((model) => model.id === "gpt-5-mini")?.accessible).toBe(
      true
    )
    expect(models.find((model) => model.id === "gpt-5.4")?.accessible).toBe(
      false
    )
    expect(models.some((model) => model.id === "pixtral-large-2411")).toBe(
      false
    )
  })

  it("exposes web search for Opus 5 through its OpenRouter route", () => {
    expect(
      getLogicalModelInfo("openrouter:anthropic/claude-opus-5")?.webSearch
    ).toBe(true)
  })
})
