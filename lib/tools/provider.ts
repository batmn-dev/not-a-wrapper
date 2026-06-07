// lib/tools/provider.ts

import type { ToolSet } from "ai"
import type { ToolMetadata } from "./types"

/**
 * Provider IDs that have native built-in search tools.
 * These tools use the same API key as the model itself — zero additional config.
 *
 * Verified exports (AI SDK v6.0.78, February 2026):
 *   - openai:    openai.tools.webSearch({})
 *   - anthropic: anthropic.tools.webSearch_20250305({})
 *   - google:    google.tools.googleSearch({})
 *   - xai:       xai.tools.webSearch({})
 */
const PROVIDERS_WITH_SEARCH = ["openai", "anthropic", "google", "xai"] as const
type SearchProvider = (typeof PROVIDERS_WITH_SEARCH)[number]

/**
 * Returns provider-specific built-in tools for the given provider ID.
 *
 * IMPORTANT: Uses the resolved API key (BYOK or platform) to create a
 * fresh provider instance. This ensures tool calls bill to the same key
 * as model calls — critical for the BYOK model.
 *
 * When `apiKey` is undefined, the provider factory falls back to the
 * corresponding environment variable (e.g., `OPENAI_API_KEY`). This is
 * the same behavior as `createLanguageModel(modelConfig, apiKey)` in route.ts.
 *
 * Provider instances (createOpenAI, createAnthropic, createGoogleGenerativeAI,
 * createXai) are stateless HTTP client factories — they do not hold connections
 * or resources. No after() cleanup is needed; instances are GC'd when the
 * request completes.
 *
 * @param providerId - The provider string from getProviderForModel()
 * @param apiKey - The resolved API key (BYOK or undefined for env fallback)
 * @returns A ToolSet with provider-specific tools, or empty object
 */
export async function getProviderTools(
  providerId: string,
  apiKey?: string
): Promise<{
  tools: ToolSet
  metadata: Map<string, ToolMetadata>
}> {
  const tools: Record<string, unknown> = {}
  const metadata = new Map<string, ToolMetadata>()

  if (!isSearchProvider(providerId)) {
    return { tools: tools as ToolSet, metadata }
  }

  switch (providerId) {
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai")
      const openaiProvider = createOpenAI(apiKey ? { apiKey } : {})
      tools.web_search = openaiProvider.tools.webSearch({})
      metadata.set("web_search", {
        displayName: "Web Search",
        source: "builtin",
        serviceName: "OpenAI",
        icon: "search",
        estimatedCostPer1k: 30, // ~$25-50/1K depending on searchContextSize
        readOnly: true,
        openWorld: true,
      })
      break
    }
    case "anthropic": {
      // Verified: webSearch_20250305 is the correct export (Task V1, Feb 2026)
      const { createAnthropic } = await import("@ai-sdk/anthropic")
      const anthropicProvider = createAnthropic(apiKey ? { apiKey } : {})
      tools.web_search = anthropicProvider.tools.webSearch_20250305()
      metadata.set("web_search", {
        displayName: "Web Search",
        source: "builtin",
        serviceName: "Anthropic",
        icon: "search",
        estimatedCostPer1k: 10, // Usage-based, varies
        readOnly: true,
        openWorld: true,
      })
      break
    }
    case "google": {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google")
      const googleProvider = createGoogleGenerativeAI(apiKey ? { apiKey } : {})
      tools.web_search = googleProvider.tools.googleSearch({})
      metadata.set("web_search", {
        displayName: "Web Search",
        source: "builtin",
        serviceName: "Google",
        icon: "search",
        estimatedCostPer1k: 35, // Grounding billing started Jan 5, 2026
        readOnly: true,
        openWorld: true,
      })
      break
    }
    case "xai": {
      // Verified: xAI exports webSearch tool (discovered Feb 2026)
      const { createXai } = await import("@ai-sdk/xai")
      const xaiProvider = createXai(apiKey ? { apiKey } : {})
      tools.web_search = xaiProvider.tools.webSearch({})
      metadata.set("web_search", {
        displayName: "Web Search",
        source: "builtin",
        serviceName: "xAI",
        icon: "search",
        estimatedCostPer1k: 0, // Included in Grok API pricing
        readOnly: true,
        openWorld: true,
      })
      break
    }
  }

  return { tools: tools as ToolSet, metadata }
}

function isSearchProvider(providerId: string): providerId is SearchProvider {
  return (PROVIDERS_WITH_SEARCH as readonly string[]).includes(providerId)
}
