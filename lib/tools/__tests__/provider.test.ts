import { describe, expect, it, vi } from "vitest"
import { getProviderTools } from "../provider"

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => ({
    tools: {
      webSearch: () => ({ description: "openai-web-search" }),
    },
  }),
}))

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: () => ({
    tools: {
      webSearch_20250305: () => ({ description: "anthropic-web-search" }),
    },
  }),
}))

vi.mock("@ai-sdk/google", () => ({
  createGoogle: () => ({
    tools: {
      googleSearch: () => ({ description: "google-search" }),
    },
  }),
}))

vi.mock("@ai-sdk/xai", () => ({
  createXai: () => ({
    tools: {
      webSearch: () => ({ description: "xai-web-search" }),
    },
  }),
}))

vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: () => ({
    tools: {
      webSearch: () => ({ description: "openrouter-web-search" }),
    },
  }),
}))

describe("provider tools metadata", () => {
  it.each(["openai", "anthropic", "google", "xai", "openrouter"] as const)(
    "marks %s web search as open-world",
    async (providerId) => {
      const { metadata, tools } = await getProviderTools(providerId, "test_key")
      expect(Object.keys(tools)).toContain("web_search")
      expect(metadata.get("web_search")?.openWorld).toBe(true)
      expect(metadata.get("web_search")?.readOnly).toBe(true)
    }
  )
})
