import { describe, expect, it } from "vitest"
import {
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
