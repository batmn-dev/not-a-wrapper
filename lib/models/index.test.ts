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

  it("omits hidden and legacy entries from the visible selector catalog", async () => {
    const visibleModelIds = (await getVisibleModels()).map((model) => model.id)

    expect(visibleModelIds).toContain("gpt-5.4")
    expect(visibleModelIds).toContain("claude-haiku-4-5-20251001")
    expect(visibleModelIds).not.toContain("gpt-5.1")
    expect(visibleModelIds).not.toContain("claude-sonnet-4-5-20250929")
    expect(visibleModelIds).not.toContain("pixtral-large-2411")
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
