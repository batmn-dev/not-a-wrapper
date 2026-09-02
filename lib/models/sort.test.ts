import { describe, expect, it } from "vitest"
import { getVisibleLogicalModelViews } from "."
import {
  compareModelsForProviderSection,
  compareProviderSections,
  getOrderedModelSections,
} from "./sort"
import type { ModelConfig } from "./types"

function model(
  name: string,
  fields: Partial<
    Pick<
      ModelConfig,
      "releasedAt" | "intelligence" | "inputCost" | "outputCost"
    >
  > = {}
) {
  return { name, ...fields }
}

function withoutArrayToSorted<T>(run: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(
    Array.prototype,
    "toSorted"
  )
  Object.defineProperty(Array.prototype, "toSorted", {
    configurable: true,
    value: undefined,
  })

  try {
    return run()
  } finally {
    if (descriptor) {
      Object.defineProperty(Array.prototype, "toSorted", descriptor)
    } else {
      Reflect.deleteProperty(Array.prototype, "toSorted")
    }
  }
}

describe("compareModelsForProviderSection", () => {
  it("has complete ranking facts for every visible logical model", () => {
    const incompleteModels = getVisibleLogicalModelViews()
      .filter(
        (catalogModel) =>
          !catalogModel.releasedAt ||
          Number.isNaN(Date.parse(catalogModel.releasedAt)) ||
          !catalogModel.intelligence ||
          catalogModel.inputCost === undefined ||
          catalogModel.outputCost === undefined
      )
      .map(({ id }) => id)

    expect(incompleteModels).toEqual([])
  })

  it("sorts by release date before intelligence or price", () => {
    const sorted = [
      model("Older flagship", {
        releasedAt: "2025-12-01",
        intelligence: "High",
        inputCost: 20,
        outputCost: 80,
      }),
      model("Newer workhorse", {
        releasedAt: "2026-01-01",
        intelligence: "Medium",
        inputCost: 0.1,
        outputCost: 0.2,
      }),
    ].sort(compareModelsForProviderSection)

    expect(sorted.map(({ name }) => name)).toEqual([
      "Newer workhorse",
      "Older flagship",
    ])
  })

  it("uses intelligence and then price for models released together", () => {
    const releasedAt = "2026-01-01"
    const sorted = [
      model("Medium expensive", {
        releasedAt,
        intelligence: "Medium",
        inputCost: 20,
        outputCost: 80,
      }),
      model("High cheap", {
        releasedAt,
        intelligence: "High",
        inputCost: 1,
        outputCost: 2,
      }),
      model("High expensive", {
        releasedAt,
        intelligence: "High",
        inputCost: 5,
        outputCost: 25,
      }),
    ].sort(compareModelsForProviderSection)

    expect(sorted.map(({ name }) => name)).toEqual([
      "High expensive",
      "High cheap",
      "Medium expensive",
    ])
  })

  it("puts missing or invalid release dates last with a stable name tie-break", () => {
    const sorted = [
      model("Zulu", { releasedAt: "unknown" }),
      model("Dated", { releasedAt: "2025-01-01" }),
      model("Alpha"),
    ].sort(compareModelsForProviderSection)

    expect(sorted.map(({ name }) => name)).toEqual(["Dated", "Alpha", "Zulu"])
  })
})

describe("compareProviderSections", () => {
  it("uses the product-defined vendor order", () => {
    const providers = [
      "openai",
      "mistral",
      "google",
      "anthropic",
      "deepseek",
      "perplexity",
      "xai",
      "vendor-b",
      "vendor-a",
    ]

    expect(providers.sort(compareProviderSections)).toEqual([
      "anthropic",
      "openai",
      "xai",
      "google",
      "perplexity",
      "mistral",
      "deepseek",
      "vendor-a",
      "vendor-b",
    ])
  })
})

describe("getOrderedModelSections", () => {
  it("orders models without requiring Array.prototype.toSorted", () => {
    const input = [
      {
        ...model("Mistral Older", { releasedAt: "2025-01-01" }),
        baseProviderId: "mistral",
      },
      {
        ...model("OpenAI Newer", { releasedAt: "2026-03-01" }),
        baseProviderId: "openai",
      },
      {
        ...model("Anthropic Older", { releasedAt: "2025-06-01" }),
        baseProviderId: "anthropic",
      },
      {
        ...model("Mistral Newer", { releasedAt: "2026-01-01" }),
        baseProviderId: "mistral",
      },
      {
        ...model("DeepSeek", { releasedAt: "2026-04-01" }),
        baseProviderId: "deepseek",
      },
    ]
    const sections = withoutArrayToSorted(() => {
      expect(getVisibleLogicalModelViews()).not.toHaveLength(0)
      return getOrderedModelSections(input)
    })

    expect(sections.map(({ vendorId }) => vendorId)).toEqual([
      "anthropic",
      "openai",
      "mistral",
      "deepseek",
    ])
    expect(
      sections
        .find(({ vendorId }) => vendorId === "mistral")
        ?.models.map(({ name }) => name)
    ).toEqual(["Mistral Newer", "Mistral Older"])
    expect(input.map(({ name }) => name)).toEqual([
      "Mistral Older",
      "OpenAI Newer",
      "Anthropic Older",
      "Mistral Newer",
      "DeepSeek",
    ])
  })
})
