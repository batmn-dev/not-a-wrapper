import { describe, expect, it } from "vitest"
import {
  getAllModels,
  getVisibleModels,
  getVisibleModelsWithAccessFlags,
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

  it("points legacy replacement metadata at visible catalog entries", async () => {
    const allModels = await getAllModels()
    const modelStatusById = new Map(
      allModels.map((model) => [model.id, model.catalogStatus])
    )
    const invalidLegacyReplacementTargets = allModels
      .filter(
        (model) =>
          model.catalogStatus === "legacy" &&
          model.replacementModelId &&
          modelStatusById.get(model.replacementModelId) !== "visible"
      )
      .map((model) => ({
        id: model.id,
        replacementModelId: model.replacementModelId,
        replacementStatus: model.replacementModelId
          ? (modelStatusById.get(model.replacementModelId) ?? "missing")
          : "missing",
      }))

    expect(invalidLegacyReplacementTargets).toEqual([])
  })

  it("adds access flags only to the curated visible catalog", async () => {
    const models = await getVisibleModelsWithAccessFlags()

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
})
