// lib/tools/provider.ts

import { getProviderStrategy } from "@/lib/openproviders/provider-strategy"
import type { Provider } from "@/lib/openproviders/types"
import type { ToolSet } from "ai"
import type { ToolMetadata } from "./types"

/**
 * Returns the provider's native built-in search tool (Tool layer 1) for the
 * given provider id, keyed as `web_search`, plus its display metadata.
 *
 * Provider-instance creation now lives behind the provider strategy: the SAME
 * instance backs the language model and this tool, so tool calls bill to the
 * same key as model calls — the BYOK invariant is structural, not a hand-synced
 * convention. Providers without a native search tool (mistral, perplexity)
 * return an empty set.
 *
 * @param providerId - The provider string from getProviderForModel()
 * @param apiKey - The resolved API key (BYOK or undefined for env fallback)
 */
export async function getProviderTools(
  providerId: string,
  apiKey?: string
): Promise<{
  tools: ToolSet
  metadata: Map<string, ToolMetadata>
}> {
  const metadata = new Map<string, ToolMetadata>()
  const strategy = getProviderStrategy(providerId as Provider)

  // No native search tool for this provider (or an unknown provider id).
  if (!strategy?.searchToolMetadata) {
    return { tools: {} as ToolSet, metadata }
  }

  const tool = strategy.instance(apiKey).searchTool()
  if (!tool) {
    return { tools: {} as ToolSet, metadata }
  }

  metadata.set("web_search", strategy.searchToolMetadata)
  return { tools: { web_search: tool } as ToolSet, metadata }
}
