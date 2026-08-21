import { getDefaultModelForUser } from "@/lib/config"
import type { ModelConfig } from "@/lib/models/types"
import { describe, expect, it } from "vitest"
import {
  DEFAULT_MODEL_ORDER,
  groupModelsForSelector,
  isModelAllowedForAnonymous,
  isModelSelectableForAuthState,
  resolvePreferredModelId,
} from "./utils"

const MODELS: ModelConfig[] = [
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
    provider: "OpenAI",
    providerId: "openai",
    catalogStatus: "visible",
    idKind: "stable",
    baseProviderId: "openai",
    accessible: false,
  },
  {
    id: "gpt-5-mini",
    name: "GPT-5 Mini",
    provider: "OpenAI",
    providerId: "openai",
    catalogStatus: "visible",
    idKind: "stable",
    baseProviderId: "openai",
    accessible: true,
  },
  {
    id: "gpt-4.1",
    name: "GPT-4.1",
    provider: "OpenAI",
    providerId: "openai",
    catalogStatus: "hidden",
    idKind: "stable",
    baseProviderId: "openai",
    accessible: true,
  },
  {
    id: "claude-haiku-4-5-20251001",
    name: "Haiku 4.5",
    provider: "Anthropic",
    providerId: "anthropic",
    catalogStatus: "visible",
    idKind: "snapshot",
    baseProviderId: "claude",
    accessible: true,
  },
]

const VISIBLE_MODELS = MODELS.filter(
  (model) => model.catalogStatus === "visible"
)

describe("resolvePreferredModelId", () => {
  it("preserves the current chat model even when it is not accessible", () => {
    expect(
      resolvePreferredModelId({
        models: VISIBLE_MODELS,
        isAuthenticated: true,
        currentModelId: "gpt-5.1",
        preferredModelIds: ["gpt-5-mini"],
      })
    ).toBe("gpt-5.1")
  })

  it("preserves a legacy routed chat model for server route selection", () => {
    // The wrapped Sonnet 5 route is mapped onto the direct logical model
    // (ADR-0020), but an old chat keeps its route hint for the next request.
    expect(
      resolvePreferredModelId({
        models: VISIBLE_MODELS,
        isAuthenticated: true,
        currentModelId: "openrouter:anthropic/claude-sonnet-5",
        preferredModelIds: [],
      })
    ).toBe("openrouter:anthropic/claude-sonnet-5")
  })

  it("prefers the first accessible visible stored model before hidden legacy models", () => {
    expect(
      resolvePreferredModelId({
        models: VISIBLE_MODELS,
        isAuthenticated: true,
        preferredModelIds: ["gpt-4.1", "claude-haiku-4-5"],
      })
    ).toBe("claude-haiku-4-5-20251001")
  })

  it("falls back to the tier default when stored models are unavailable", () => {
    expect(
      resolvePreferredModelId({
        models: VISIBLE_MODELS,
        isAuthenticated: false,
        preferredModelIds: ["missing-model"],
      })
    ).toBe(getDefaultModelForUser(false))
  })

  it("does not preserve a locked current model for anonymous users", () => {
    expect(
      resolvePreferredModelId({
        models: VISIBLE_MODELS,
        isAuthenticated: false,
        currentModelId: "gpt-5.4",
        preferredModelIds: ["claude-haiku-4-5-20251001", "gpt-5-mini"],
      })
    ).toBe("gpt-5-mini")
  })
})

describe("model access by auth state", () => {
  it("uses the anonymous allowlist rather than the broader free-model access flag", () => {
    const signedOutSelectable = VISIBLE_MODELS.filter((model) =>
      isModelSelectableForAuthState(model, false)
    ).map((model) => model.id)

    expect(signedOutSelectable).toEqual(["gpt-5-mini"])
    expect(isModelAllowedForAnonymous("gpt-5-mini")).toBe(true)
    expect(isModelAllowedForAnonymous("mistral-large-2512")).toBe(false)
  })

  it("uses existing model accessibility for signed-in users", () => {
    expect(isModelSelectableForAuthState(VISIBLE_MODELS[0]!, true)).toBe(false)
    expect(isModelSelectableForAuthState(VISIBLE_MODELS[1]!, true)).toBe(true)
  })
})

describe("groupModelsForSelector", () => {
  const isModelHidden = () => false

  it("prunes models marked invisible for selectors", () => {
    const { favorites, others } = groupModelsForSelector(
      MODELS,
      [],
      "",
      isModelHidden
    )
    const ids = [...favorites, ...others].map((model) => model.id)
    expect(ids).not.toContain("gpt-4.1")
  })

  it("ranks favorites without hiding the rest of the catalog", () => {
    const { favorites, others } = groupModelsForSelector(
      MODELS,
      ["gpt-5-mini", "claude-haiku-4-5-20251001"],
      "",
      isModelHidden
    )

    expect(favorites.map((model) => model.id)).toEqual([
      "gpt-5-mini",
      "claude-haiku-4-5-20251001",
    ])
    expect(others.map((model) => model.id)).toEqual(["gpt-5.4"])
  })

  it("searches the whole catalog, not just favorites", () => {
    const { favorites, others } = groupModelsForSelector(
      MODELS,
      ["gpt-5-mini"],
      "gpt-5.4",
      isModelHidden
    )

    expect(favorites).toEqual([])
    expect(others.map((model) => model.id)).toEqual(["gpt-5.4"])
  })

  it("keeps locked models visible", () => {
    const { others } = groupModelsForSelector(MODELS, [], "", isModelHidden)
    expect(others.some((model) => model.id === "gpt-5.4")).toBe(true)
  })

  it("still honors explicit user-hidden models", () => {
    const { favorites, others } = groupModelsForSelector(
      MODELS,
      ["gpt-5-mini"],
      "",
      (modelId) => modelId === "gpt-5-mini"
    )

    expect(favorites).toEqual([])
    expect(others.some((model) => model.id === "gpt-5-mini")).toBe(false)
  })

  it("orders OpenRouter-backed additions by their logical selector ids", () => {
    expect(DEFAULT_MODEL_ORDER).toContain("claude-sonnet-4-6")
    expect(DEFAULT_MODEL_ORDER).not.toContain(
      "openrouter:anthropic/claude-sonnet-4.6"
    )
    expect(DEFAULT_MODEL_ORDER).toContain("openrouter:qwen/qwen3.8-27b")
  })
})
