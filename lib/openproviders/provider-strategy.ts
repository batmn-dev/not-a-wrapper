import type { ToolMetadata } from "@/lib/tools/types"
import { anthropic, createAnthropic } from "@ai-sdk/anthropic"
import { createGoogle, google } from "@ai-sdk/google"
import { createMistral, mistral } from "@ai-sdk/mistral"
import { createOpenAI, openai } from "@ai-sdk/openai"
import { createPerplexity, perplexity } from "@ai-sdk/perplexity"
import type { LanguageModelV3, LanguageModelV4 } from "@ai-sdk/provider"
import { createXai, xai } from "@ai-sdk/xai"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import type { ToolSet } from "ai"
import type { Provider } from "./types"

/**
 * Strip the internal `openrouter:` namespace prefix before handing the id to
 * the OpenRouter chat endpoint, whose catalog id is the bare `vendor/model`
 * form. OpenRouter-only — the other six providers use bare native ids.
 */
function toOpenRouterChatModelId(modelId: string): string {
  return modelId.startsWith("openrouter:")
    ? modelId.slice("openrouter:".length)
    : modelId
}

/**
 * The one unavoidable cast. A provider's native tool (e.g.
 * `openai.tools.webSearch({})`) is a `Tool` with a concrete input-schema
 * generic that does not widen to the `ToolSet` element type — the same SDK
 * friction the previous `getProviderTools` papered over with a blanket
 * `as ToolSet`. Localized here so every search strategy is otherwise cast-free.
 */
function asSearchTool(tool: unknown): ToolSet[string] {
  return tool as ToolSet[string]
}

/**
 * The concrete model shapes our providers produce: the first-party @ai-sdk
 * v4-generation providers implement `LanguageModelV4`; the community
 * OpenRouter provider still implements `LanguageModelV3` (ai@7 accepts both
 * spec versions). Widening past this union — e.g. a provider handing back a
 * V2 model — should fail compilation rather than silently regress.
 */
export type ProviderLanguageModel = LanguageModelV4 | LanguageModelV3

/**
 * A provider's @ai-sdk client, constructed once from a resolved API key and
 * usable for BOTH the language model and the built-in search tool — so tool
 * calls structurally bill to the same key as model calls (BYOK parity is no
 * longer a hand-synced convention across two modules).
 */
export type ProviderInstance = {
  /**
   * Build the language model. The model-id argument is the SDK's open string
   * enum, so no literal-union cast is needed.
   */
  languageModel(resolvedModelId: string): ProviderLanguageModel
  /**
   * The provider's native built-in web search tool, or undefined if it has
   * none. Typed as the AI SDK's tool-set element type — the type the SDK itself
   * uses for a tool inside a `ToolSet` — since provider tool generics do not
   * widen to the bare `Tool` alias.
   */
  searchTool(): ToolSet[string] | undefined
}

/**
 * Provider strategy (CONTEXT.md): the single home for everything STATICALLY
 * true about one provider's @ai-sdk SDK — how to instantiate its client (BYOK
 * key vs default/env credentials), its optional native search tool plus that
 * tool's display metadata, and its platform API-key environment variable.
 * Stateless; one per Provider, behind a registry keyed by `getProviderForModel`.
 *
 * It deliberately does NOT own routing (the selector that reads catalog
 * membership), key selection/precedence (BYOK > env, decryption — it only
 * declares the env-var NAME; resolution consumes it), request shaping
 * (per-model request policy — see `shapeRequest`), or history adaptation
 * (a sibling seam with a different, non-1:1 taxonomy).
 *
 * `languageModel` is synchronous: the registry is statically constructed and
 * the provider SDKs are eagerly imported, because model construction has
 * always had to return a non-Promise `ProviderLanguageModel`.
 */
export type ProviderStrategy = {
  readonly id: Provider
  /** Environment variable holding this provider's platform API key. */
  readonly envVarName: string
  /** Display metadata for the native search tool, present iff the provider has one. */
  readonly searchToolMetadata?: ToolMetadata
  /**
   * Construct the SDK client bound to `apiKey`, or to the provider's
   * default/env credentials when `apiKey` is undefined.
   */
  instance(apiKey?: string): ProviderInstance
}

const STRATEGIES: Record<Provider, ProviderStrategy> = {
  openai: {
    id: "openai",
    envVarName: "OPENAI_API_KEY",
    searchToolMetadata: {
      displayName: "Web Search",
      source: "builtin",
      serviceName: "OpenAI",
      icon: "search",
      estimatedCostPer1k: 30, // ~$25-50/1K depending on searchContextSize
      readOnly: true,
      openWorld: true,
    },
    instance(apiKey) {
      const provider = apiKey ? createOpenAI({ apiKey }) : openai
      return {
        languageModel: (id) => provider(id),
        searchTool: () => asSearchTool(provider.tools.webSearch({})),
      }
    },
  },
  anthropic: {
    id: "anthropic",
    envVarName: "ANTHROPIC_API_KEY",
    searchToolMetadata: {
      displayName: "Web Search",
      source: "builtin",
      serviceName: "Anthropic",
      icon: "search",
      estimatedCostPer1k: 10, // Usage-based, varies
      readOnly: true,
      openWorld: true,
    },
    instance(apiKey) {
      const provider = apiKey ? createAnthropic({ apiKey }) : anthropic
      return {
        languageModel: (id) => provider(id),
        // Verified: webSearch_20250305 is the correct export (Task V1, Feb 2026)
        searchTool: () => asSearchTool(provider.tools.webSearch_20250305()),
      }
    },
  },
  google: {
    id: "google",
    envVarName: "GOOGLE_GENERATIVE_AI_API_KEY",
    searchToolMetadata: {
      displayName: "Web Search",
      source: "builtin",
      serviceName: "Google",
      icon: "search",
      estimatedCostPer1k: 35, // Grounding billing started Jan 5, 2026
      readOnly: true,
      openWorld: true,
    },
    instance(apiKey) {
      const provider = apiKey ? createGoogle({ apiKey }) : google
      return {
        languageModel: (id) => provider(id),
        searchTool: () => asSearchTool(provider.tools.googleSearch({})),
      }
    },
  },
  xai: {
    id: "xai",
    envVarName: "XAI_API_KEY",
    searchToolMetadata: {
      displayName: "Web Search",
      source: "builtin",
      serviceName: "xAI",
      icon: "search",
      estimatedCostPer1k: 0, // Included in Grok API pricing
      readOnly: true,
      openWorld: true,
    },
    instance(apiKey) {
      const provider = apiKey ? createXai({ apiKey }) : xai
      return {
        // Responses API, not chat completions: xAI's server-side agentic
        // tools (webSearch below) are Responses-only — the chat-completions
        // class 400s at api.x.ai/v1/chat/completions once the tool engages.
        // All four cataloged Grok ids verified against responses 2026-07-03.
        languageModel: (id) => provider.responses(id),
        searchTool: () => asSearchTool(provider.tools.webSearch({})),
      }
    },
  },
  mistral: {
    id: "mistral",
    envVarName: "MISTRAL_API_KEY",
    instance(apiKey) {
      const provider = apiKey ? createMistral({ apiKey }) : mistral
      return {
        languageModel: (id) => provider(id),
        searchTool: () => undefined,
      }
    },
  },
  perplexity: {
    id: "perplexity",
    envVarName: "PERPLEXITY_API_KEY",
    instance(apiKey) {
      const provider = apiKey ? createPerplexity({ apiKey }) : perplexity
      return {
        languageModel: (id) => provider(id),
        searchTool: () => undefined,
      }
    },
  },
  openrouter: {
    id: "openrouter",
    envVarName: "OPENROUTER_API_KEY",
    instance(apiKey) {
      // OpenRouter is the documented irregular: no callable default singleton,
      // self-resolved env fallback (the SDK does not read it), `.chat()` to
      // produce a LanguageModelV3 (the community provider has no v4-spec
      // release; ai@7 accepts V3 models), and the `openrouter:` prefix strip.
      // All four stay body-internal — they never widen the shared interface.
      const provider = createOpenRouter({
        apiKey: apiKey || process.env.OPENROUTER_API_KEY,
        compatibility: "strict",
      })
      return {
        languageModel: (id) => provider.chat(toOpenRouterChatModelId(id)),
        searchTool: () => undefined,
      }
    },
  },
}

/**
 * The provider strategy for a resolved provider id. Total over the `Provider`
 * union — every provider has a strategy.
 */
export function getProviderStrategy(provider: Provider): ProviderStrategy {
  return STRATEGIES[provider]
}
