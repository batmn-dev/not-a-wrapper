import { describe, expect, it } from "vitest"
import { getModelInfo } from "./index"
import {
  resolveCompatibilityModelId,
  resolveLegacyAliasModelId,
  resolveModelId,
  resolveModelIds,
} from "./model-id-migration"

describe("model ID migration", () => {
  it("keeps alias cleanup separate from explicit successor remaps", () => {
    expect(resolveLegacyAliasModelId("gpt-5.6")).toBe("gpt-5.6-sol")
    expect(resolveLegacyAliasModelId("mistral-medium-3.5")).toBe(
      "mistral-medium-3-5"
    )
    expect(resolveLegacyAliasModelId("claude-sonnet-4-5")).toBe(
      "claude-sonnet-4-5-20250929"
    )
    expect(resolveLegacyAliasModelId("gpt-5.2")).toBe("gpt-5.2")
    expect(resolveCompatibilityModelId("gpt-5.2")).toBe("gpt-5.4")
  })

  it("keeps compatibility remaps limited to explicit aliases and safe successors", () => {
    expect(resolveModelId("deepseek-v3")).toBe("openrouter:openai/gpt-oss-120b")
    expect(resolveModelId("openrouter:deepseek/deepseek-r1:free")).toBe(
      "openrouter:openai/gpt-oss-120b"
    )
    expect(
      resolveModelId("openrouter:meta-llama/llama-3.3-8b-instruct:free")
    ).toBe("openrouter:meta-llama/llama-3.3-70b-instruct")
    expect(resolveModelId("openrouter:openai/gpt-oss-120b:free")).toBe(
      "openrouter:openai/gpt-oss-120b"
    )
    expect(
      resolveModelId("openrouter:meta-llama/llama-3.3-70b-instruct:free")
    ).toBe("openrouter:meta-llama/llama-3.3-70b-instruct")
    expect(resolveModelId("openrouter:qwen/qwen3-coder:free")).toBe(
      "openrouter:qwen/qwen3-coder"
    )
    expect(resolveModelId("openrouter:xiaomi/mimo-v2-flash")).toBe(
      "openrouter:xiaomi/mimo-v2.5"
    )
    // Alias-of-a-delisted-id chains through the succession in one resolve.
    expect(resolveModelId("deepseek-r1")).toBe("openrouter:openai/gpt-oss-120b")
    expect(resolveModelId("mistral-small-2503")).toBe("mistral-small-2506")
    expect(resolveModelId("mistral-small-latest")).toBe("mistral-small-2603")
    expect(resolveModelId("ministral-14b-latest")).toBe("ministral-14b-2512")
    expect(resolveModelId("mistral-large-latest")).toBe("mistral-large-2512")
    expect(resolveModelId("sonar-reasoning")).toBe("sonar-reasoning-pro")
    expect(resolveModelId("grok-4")).toBe("grok-4-0709")
    expect(resolveModelId("gpt-5.2")).toBe("gpt-5.4")
    expect(resolveModelId("o4-mini")).toBe("gpt-5-mini")
    expect(resolveModelId("claude-sonnet-4-5")).toBe(
      "claude-sonnet-4-5-20250929"
    )
    expect(resolveModelId("claude-haiku-4-5")).toBe("claude-haiku-4-5-20251001")
  })

  it("normalizes arrays and de-duplicates in stable order", () => {
    expect(
      resolveModelIds([
        "deepseek-r1",
        "openrouter:deepseek/deepseek-r1:free",
        "gpt-5.2",
        "gpt-5.4",
        "o4-mini",
        "gpt-5-mini",
        "claude-haiku-4-5",
        "claude-haiku-4-5-20251001",
      ])
    ).toEqual([
      "openrouter:openai/gpt-oss-120b",
      "gpt-5.4",
      "gpt-5-mini",
      "claude-haiku-4-5-20251001",
    ])
  })

  it("does not silently cross-normalize wrapped OpenRouter IDs into direct providers", () => {
    expect(resolveModelId("openrouter:openai/gpt-4.1")).toBe(
      "openrouter:openai/gpt-4.1"
    )
    expect(resolveModelId("openrouter:perplexity/sonar")).toBe(
      "openrouter:perplexity/sonar"
    )
    expect(resolveModelId("openrouter:google/gemini-2.5-pro")).toBe(
      "openrouter:google/gemini-2.5-pro"
    )
  })

  it("does not auto-remap removed distinct generation IDs without an explicit policy", () => {
    expect(resolveModelId("gpt-5.1-thinking")).toBe("gpt-5.1-thinking")
    expect(resolveModelId("grok-2")).toBe("grok-2")
    expect(resolveModelId("claude-sonnet-4-20250514")).toBe(
      "claude-sonnet-4-20250514"
    )
  })

  it("keeps catalog lookups backward compatible for migrated IDs", () => {
    expect(getModelInfo("gpt-5.6")?.id).toBe("gpt-5.6-sol")
    expect(getModelInfo("mistral-medium-3.5")?.id).toBe("mistral-medium-3-5")
    expect(getModelInfo("grok-4")?.id).toBe("grok-4-0709")
    expect(getModelInfo("claude-haiku-4-5")?.id).toBe(
      "claude-haiku-4-5-20251001"
    )
    expect(getModelInfo("gpt-5.2")?.id).toBe("gpt-5.4")
    expect(getModelInfo("claude-sonnet-4-5")?.id).toBe(
      "claude-sonnet-4-5-20250929"
    )
  })
})
