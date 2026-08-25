import { describe, expect, it } from "vitest"
import {
  getModelDisplayName,
  getModelPresentationVendorId,
  getRouteProviderLabels,
} from "./presentation"

describe("model presentation", () => {
  it("prefers an explicit model icon identity over the base provider", () => {
    expect(
      getModelPresentationVendorId({
        icon: "claude",
        baseProviderId: "anthropic",
      })
    ).toBe("claude")
  })

  it("uses the base provider when an explicit icon identity is absent", () => {
    expect(getModelPresentationVendorId({ baseProviderId: "anthropic" })).toBe(
      "anthropic"
    )
  })

  it("derives ordered, de-duplicated labels from provider identity", () => {
    expect(
      getRouteProviderLabels([
        { providerId: "anthropic" },
        { providerId: "openrouter" },
        { providerId: "anthropic" },
      ])
    ).toEqual([
      { providerId: "anthropic", name: "Anthropic" },
      { providerId: "openrouter", name: "OpenRouter" },
    ])
  })
})

describe("getModelDisplayName", () => {
  it("uses the full name by default and for the full variant", () => {
    const model = { name: "GPT-5.6 Sol", shortName: "5.6 Sol" }

    expect(getModelDisplayName(model)).toBe("GPT-5.6 Sol")
    expect(getModelDisplayName(model, "full")).toBe("GPT-5.6 Sol")
  })

  it("falls back to the full name when no compact name is authored", () => {
    expect(getModelDisplayName({ name: "Claude Sonnet 5" }, "compact")).toBe(
      "Claude Sonnet 5"
    )
  })

  it("uses the authored compact name without deriving it from the id", () => {
    expect(
      getModelDisplayName(
        { name: "GPT-5.6 Terra", shortName: "5.6 Terra" },
        "compact"
      )
    ).toBe("5.6 Terra")
  })
})
