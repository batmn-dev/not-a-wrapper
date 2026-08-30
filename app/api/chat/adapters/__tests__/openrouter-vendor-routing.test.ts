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
    adapterLabel: string
  }> = [
    {
      targetModelId: "openrouter:anthropic/claude-sonnet-5",
      expectedAdapter: anthropicAdapter,
      adapterLabel: "anthropic",
    },
    {
      targetModelId: "openrouter:deepseek/deepseek-v4-pro",
      expectedAdapter: openaiCompatibleAdapter,
      adapterLabel: "OpenAI-compatible",
    },
    {
      targetModelId: "openrouter:x-ai/grok-4.3",
      expectedAdapter: openaiCompatibleAdapter,
      adapterLabel: "OpenAI-compatible",
    },
    {
      targetModelId: "openrouter:meta-llama/llama-3.3-70b-instruct:free",
      expectedAdapter: openaiCompatibleAdapter,
      adapterLabel: "OpenAI-compatible",
    },
    {
      targetModelId: "openrouter:stealth/ox-alpha",
      expectedAdapter: openaiCompatibleAdapter,
      adapterLabel: "OpenAI-compatible",
    },
    {
      targetModelId: "openrouter:unknown-org/mystery-model",
      expectedAdapter: defaultAdapter,
      adapterLabel: "default",
    },
  ]

  for (const { targetModelId, expectedAdapter, adapterLabel } of cases) {
    it(`routes ${targetModelId} to the ${adapterLabel} adapter`, () => {
      const adapter = resolveAdapter("openrouter", {
        targetModelId,
        hasTools: true,
      })
      expect(adapter).toBe(expectedAdapter)
    })
  }

  it("uses the resolved route when the target model is a merged logical id", () => {
    const adapter = resolveAdapter("openrouter", {
      targetModelId: "gpt-4.1",
      targetRouteId: "openrouter:openai/gpt-4.1",
      hasTools: true,
    })

    expect(adapter).toBe(openaiAdapter)
  })
})
