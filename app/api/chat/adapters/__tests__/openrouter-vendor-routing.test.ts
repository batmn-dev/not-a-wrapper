import { describe, expect, it } from "vitest"
import { anthropicAdapter } from "../anthropic"
import { defaultAdapter } from "../default"
import { resolveAdapter } from "../index"
import { openaiAdapter } from "../openai"
import { openaiCompatibleAdapter } from "../openai-compatible"

describe("OpenRouter underlying-vendor adapter routing", () => {
  const cases: Array<{
    targetModelId: string
    expectedAdapter: unknown
    expectedProviderId: string
  }> = [
    {
      targetModelId: "openrouter:anthropic/claude-sonnet-5",
      expectedAdapter: anthropicAdapter,
      expectedProviderId: "anthropic",
    },
    {
      targetModelId: "openrouter:deepseek/deepseek-v4-pro",
      expectedAdapter: openaiCompatibleAdapter,
      expectedProviderId: "deepseek",
    },
    {
      targetModelId: "openrouter:x-ai/grok-4.3",
      expectedAdapter: openaiCompatibleAdapter,
      expectedProviderId: "x-ai",
    },
    {
      targetModelId: "openrouter:meta-llama/llama-3.3-70b-instruct:free",
      expectedAdapter: openaiCompatibleAdapter,
      expectedProviderId: "meta-llama",
    },
    {
      targetModelId: "openrouter:stealth/ox-alpha",
      expectedAdapter: openaiCompatibleAdapter,
      expectedProviderId: "stealth",
    },
    {
      targetModelId: "openrouter:unknown-org/mystery-model",
      expectedAdapter: defaultAdapter,
      expectedProviderId: "default",
    },
  ]

  for (const { targetModelId, expectedAdapter, expectedProviderId } of cases) {
    it(`routes ${targetModelId} to the ${expectedProviderId} adapter`, () => {
      const { adapter, effectiveProviderId } = resolveAdapter("openrouter", {
        targetModelId,
        hasTools: true,
      })
      expect(adapter).toBe(expectedAdapter)
      expect(effectiveProviderId).toBe(expectedProviderId)
    })
  }

  it("uses the resolved route when the target model is a merged logical id", () => {
    const { adapter, effectiveProviderId } = resolveAdapter("openrouter", {
      targetModelId: "gpt-4.1",
      targetRouteId: "openrouter:openai/gpt-4.1",
      hasTools: true,
    })

    expect(adapter).toBe(openaiAdapter)
    expect(effectiveProviderId).toBe("openai")
  })
})
