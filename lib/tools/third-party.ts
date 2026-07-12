import {
  EXA_CONTENT_FRESHNESS_MAX_AGE_HOURS,
  THIRD_PARTY_EXTRACTION_CACHE_MAX_ENTRIES,
  THIRD_PARTY_EXTRACTION_CACHE_TTL_MS,
  THIRD_PARTY_SEARCH_CACHE_MAX_ENTRIES,
  THIRD_PARTY_SEARCH_CACHE_TTL_MS,
  TOOL_EXECUTION_TIMEOUT_MS,
} from "@/lib/config"
import { tool } from "ai"
import type { ToolSet } from "ai"
import { z } from "zod"
import { LruTtlCache } from "./cache"
import type { ToolPolicyGuard } from "./policy"
import type { ToolMetadata } from "./types"
import {
  enrichToolError,
  extractAbortSignalFromOptions,
  runWithToolAbortAndTimeout,
  throwIfAborted,
  truncateToolResult,
} from "./utils"

// Process-level cache shared only for public URL content.

type CachedExtraction = { url: string; title?: string; content?: string }

const extractionCache = new LruTtlCache<string, CachedExtraction>({
  ttlMs: THIRD_PARTY_EXTRACTION_CACHE_TTL_MS,
  maxEntries: THIRD_PARTY_EXTRACTION_CACHE_MAX_ENTRIES,
})

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hostname = parsed.hostname.toLowerCase()
    parsed.pathname = parsed.pathname.replace(/\/$/, "") || "/"
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.startsWith("utm_")) parsed.searchParams.delete(key)
    }
    parsed.searchParams.sort()
    return parsed.toString()
  } catch {
    return url.toLowerCase()
  }
}

function getCachedExtraction(url: string): CachedExtraction | null {
  const key = normalizeUrl(url)
  return extractionCache.get(key)
}

function setCachedExtraction(inputUrl: string, data: CachedExtraction): void {
  extractionCache.set(normalizeUrl(inputUrl), data)
}

type CachedSearchResult = {
  title?: string
  url: string
  content?: string
  publishedDate?: string
}

const searchCache = new LruTtlCache<string, CachedSearchResult[]>({
  ttlMs: THIRD_PARTY_SEARCH_CACHE_TTL_MS,
  maxEntries: THIRD_PARTY_SEARCH_CACHE_MAX_ENTRIES,
})

function normalizeQuery(query: string): string {
  return query.toLowerCase().trim().replace(/\s+/g, " ")
}

function getCachedSearch(query: string): CachedSearchResult[] | null {
  const key = normalizeQuery(query)
  return searchCache.get(key)
}

function setCachedSearch(query: string, data: CachedSearchResult[]): void {
  searchCache.set(normalizeQuery(query), data)
}

export type ThirdPartyToolOptions = {
  /** Omit search when another tool layer already provides it. */
  skipSearch?: boolean

  /**
   * Resolved Exa key passed explicitly so BYOK never mutates process state.
   * Undefined disables Exa tools.
   */
  exaKey?: string
}

/**
 * Returns third-party tools based on available API keys and capability flags.
 *
 * Uses the exa-js core SDK with a custom tool() wrapper instead of
 * @exalabs/ai-sdk, because the latter reads API keys from env vars only
 * and does not support explicit key passthrough needed for BYOK.
 *
 * Provider capability policy belongs to the caller; this module obeys
 * `skipSearch` without inspecting provider-native tools.
 *
 * @param options - Configuration for which tools to load and with which keys
 * @returns A ToolSet with third-party tools, or empty object
 */
export async function getThirdPartyTools(
  options: ThirdPartyToolOptions
): Promise<{
  tools: ToolSet
  metadata: Map<string, ToolMetadata>
}> {
  const { skipSearch = false, exaKey } = options
  const tools: Record<string, unknown> = {}
  const metadata = new Map<string, ToolMetadata>()

  // Exa Search — skip if Layer 1 already provides search
  if (!skipSearch && exaKey) {
    try {
      // exa-js is a stateless HTTP client wrapper — no cleanup or after() needed.
      // Each call creates a fresh fetch request. No connection pool or persistent state.
      const Exa = (await import("exa-js")).default
      const exa = new Exa(exaKey)

      tools.web_search = tool({
        description:
          "Search the web for current information using AI-native semantic search. " +
          "Returns up to 5 results, each with title, URL, content snippet (up to 2000 chars), and publication date.\n\n" +
          "When to use:\n" +
          "- The user asks about recent events, current data, or time-sensitive information\n" +
          "- The user explicitly asks to search, look up, or find something online\n" +
          "- You need to verify or fact-check a claim with current sources\n\n" +
          "When NOT to use:\n" +
          "- General knowledge questions you can answer confidently from training data\n" +
          "- Questions about the user's own files, code, or conversation history\n" +
          "- URLs in code snippets, import statements, or reference links\n\n" +
          "Query tips:\n" +
          "- Be specific and concise — include key terms, names, and dates when relevant\n" +
          "- Do NOT append the current year unless the user specifically asks for recent results\n" +
          "- Prefer natural language queries over keyword-stuffed searches",
        inputSchema: z.object({
          query: z
            .string()
            .min(1)
            .max(200)
            .describe("The search query — be specific for better results"),
        }),
        inputExamples: [
          {
            input: {
              query: "latest federal reserve interest rate decision summary",
            },
          },
          { input: { query: "vercel ai sdk 7 tool calling docs" } },
        ],
        execute: async ({ query }, options) => {
          const startMs = Date.now()
          const upstreamAbortSignal = options
            ? extractAbortSignalFromOptions(options)
            : undefined
          try {
            throwIfAborted(upstreamAbortSignal, {
              toolName: "web_search",
              upstreamSignal: upstreamAbortSignal,
            })

            // ── Cache check ──────────────────────────────
            const cached = getCachedSearch(query)
            if (cached) {
              console.log(
                JSON.stringify({
                  _tag: "tool_exec",
                  tool: "web_search",
                  source: "exa",
                  durationMs: Date.now() - startMs,
                  resultCount: cached.length,
                  cached: true,
                })
              )
              return truncateToolResult(cached, {
                toolName: "web_search",
                resultCategory: "search_results",
              })
            }

            // Exa SDK does not accept AbortSignal yet. Race the call against the
            // composed signal so we return promptly on upstream cancel/timeout.
            const { results } = await runWithToolAbortAndTimeout({
              toolName: "web_search",
              timeoutMs: TOOL_EXECUTION_TIMEOUT_MS,
              upstreamSignal: upstreamAbortSignal,
              operation: async () =>
                // searchAndContents does not expose the same freshness knob as getContents.
                // Keep current safe defaults and rely on cache TTL for freshness.
                exa.searchAndContents(query, {
                  type: "auto",
                  numResults: 5,
                  text: { maxCharacters: 2000 },
                  livecrawl: "fallback",
                }),
            })
            throwIfAborted(upstreamAbortSignal, {
              toolName: "web_search",
              upstreamSignal: upstreamAbortSignal,
            })
            const mapped = results.map((r) => ({
              title: r.title ?? undefined,
              url: r.url,
              content: r.text?.slice(0, 2000),
              publishedDate: r.publishedDate ?? undefined,
            }))
            setCachedSearch(query, mapped)
            console.log(
              JSON.stringify({
                _tag: "tool_exec",
                tool: "web_search",
                source: "exa",
                durationMs: Date.now() - startMs,
                resultCount: results.length,
              })
            )
            return truncateToolResult(mapped, {
              toolName: "web_search",
              resultCategory: "search_results",
            })
          } catch (err) {
            console.error(
              `[tools/exa] Search failed after ${Date.now() - startMs}ms:`,
              err instanceof Error ? err.message : String(err)
            )
            throw enrichToolError(err, "web_search")
          }
        },
      })
      metadata.set("web_search", {
        displayName: "Web Search",
        source: "third-party",
        serviceName: "Exa",
        icon: "search",
        estimatedCostPer1k: 5, // $5/1K search requests (1-25 results per request)
        readOnly: true,
        idempotent: true,
        openWorld: true,
      })
    } catch (err) {
      console.error("[tools/third-party] Failed to load Exa search:", err)
    }
  }

  return { tools: tools as ToolSet, metadata }
}

/**
 * Returns content extraction tools powered by the Exa API.
 *
 * Loaded independently of search tools — not gated on `shouldInjectSearch`
 * or `builtInHasSearch`. This ensures content extraction is available for
 * ALL providers, including those with native Layer 1 search (OpenAI,
 * Anthropic, Google, xAI).
 *
 * Follows the same { tools, metadata } return contract as getThirdPartyTools
 * and getProviderTools (Layer 1).
 *
 * @param options.exaKey - Resolved Exa API key (BYOK or platform). Undefined → empty tools.
 * @returns A ToolSet with content extraction tools, or empty object when no key
 */
export async function getContentExtractionTools(options: {
  exaKey?: string
  policyGuard?: ToolPolicyGuard
}): Promise<{
  tools: ToolSet
  metadata: Map<string, ToolMetadata>
}> {
  const { exaKey, policyGuard } = options
  const tools: Record<string, unknown> = {}
  const metadata = new Map<string, ToolMetadata>()

  if (!exaKey) {
    return { tools: tools as ToolSet, metadata }
  }

  try {
    const Exa = (await import("exa-js")).default
    const exa = new Exa(exaKey)

    tools.extract_content = tool({
      description:
        "Fetch and extract clean, readable page content from URLs. " +
        "Returns each URL with title and extracted markdown content.\n\n" +
        "When to use:\n" +
        "- The user explicitly asks to read, summarize, compare, or analyze one or more URLs\n" +
        "- You found a promising URL via search and need full page content before answering\n" +
        "- The answer depends on details that are not present in short snippets\n\n" +
        "When NOT to use:\n" +
        "- URLs in code snippets, import statements, stack traces, or citation lists unless the user asks to open them\n" +
        "- Cases where search snippets already answer the question\n" +
        "- Internal/private URLs that are unlikely to be publicly accessible\n\n" +
        "Caveats:\n" +
        "- Batch related URLs in a single call (up to 5)\n" +
        "- Keep URLs specific to avoid unnecessary extraction cost",
      inputSchema: z.object({
        urls: z
          .array(z.string().url())
          .min(1)
          .max(5)
          .describe("URLs to extract content from (1-5 URLs per call)"),
      }),
      inputExamples: [
        {
          input: {
            urls: [
              "https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling",
            ],
          },
        },
        {
          input: {
            urls: [
              "https://vercel.com/blog",
              "https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text",
            ],
          },
        },
      ],
      execute: async ({ urls }, options) => {
        const startMs = Date.now()
        const upstreamAbortSignal = options
          ? extractAbortSignalFromOptions(options)
          : undefined
        try {
          throwIfAborted(upstreamAbortSignal, {
            toolName: "extract_content",
            upstreamSignal: upstreamAbortSignal,
          })

          // ── Cache check ────────────────────────────────
          const cached = new Map<string, CachedExtraction>()
          const uncachedUrls: string[] = []
          for (const url of urls) {
            const hit = getCachedExtraction(url)
            if (hit) {
              cached.set(url, hit)
            } else {
              uncachedUrls.push(url)
            }
          }

          // If all URLs are cached, return immediately
          if (uncachedUrls.length === 0) {
            const mapped = urls.map(
              (url) => cached.get(url) ?? { url, error: "CACHE_MISS" }
            )
            console.log(
              JSON.stringify({
                _tag: "tool_exec",
                tool: "extract_content",
                source: "exa",
                durationMs: Date.now() - startMs,
                urlCount: urls.length,
                successCount: cached.size,
                failedCount: 0,
                cachedCount: cached.size,
              })
            )
            return truncateToolResult(mapped, {
              toolName: "extract_content",
              resultCategory: "content_extraction",
            })
          }
          throwIfAborted(upstreamAbortSignal, {
            toolName: "extract_content",
            upstreamSignal: upstreamAbortSignal,
          })

          // ── Persistent per-domain limit (uncached only) ─
          // Cache hits intentionally do NOT consume domain quota.
          if (policyGuard) {
            const uncachedDomainCounts = new Map<string, number>()
            for (const url of uncachedUrls) {
              try {
                const domain = new URL(url).hostname.toLowerCase()
                uncachedDomainCounts.set(
                  domain,
                  (uncachedDomainCounts.get(domain) ?? 0) + 1
                )
              } catch {
                /* invalid URL — Exa will return an error */
              }
            }
            await policyGuard.enforceExtractDomainLimit(uncachedDomainCounts)
          }
          throwIfAborted(upstreamAbortSignal, {
            toolName: "extract_content",
            upstreamSignal: upstreamAbortSignal,
          })

          // ── Fetch uncached URLs from Exa ───────────────
          // Exa SDK does not accept AbortSignal yet. Race to avoid blocking
          // response teardown on cancellation while the HTTP request continues.
          const response = await runWithToolAbortAndTimeout({
            toolName: "extract_content",
            timeoutMs: TOOL_EXECUTION_TIMEOUT_MS,
            upstreamSignal: upstreamAbortSignal,
            operation: async () => {
              const getContentsOptions = {
                text: { maxCharacters: 10000 },
                maxAgeHours: EXA_CONTENT_FRESHNESS_MAX_AGE_HOURS,
              }
              return exa.getContents(uncachedUrls, getContentsOptions)
            },
          })
          throwIfAborted(upstreamAbortSignal, {
            toolName: "extract_content",
            upstreamSignal: upstreamAbortSignal,
          })

          // SDK types for Status are minimal ({ id, status, source }) but the
          // API returns error details (tag, httpStatusCode) on failures.
          type StatusEntry = {
            id: string
            status: string
            error?: { tag: string; httpStatusCode?: number }
          }
          const statusMap = new Map<string, StatusEntry>()
          if (response.statuses) {
            for (const s of response.statuses) {
              statusMap.set(s.id, s as unknown as StatusEntry)
            }
          }

          const resultMap = new Map<string, (typeof response.results)[number]>()
          for (const r of response.results) {
            resultMap.set(r.url, r)
          }

          // Process fresh results and cache successes
          const freshResults = new Map<string, CachedExtraction>()
          const freshErrors = new Map<
            string,
            { url: string; error: string; httpStatusCode?: number }
          >()

          for (const url of uncachedUrls) {
            const status = statusMap.get(url)
            const result = resultMap.get(url)

            if (status?.status === "error") {
              freshErrors.set(url, {
                url,
                error: status.error?.tag ?? "UNKNOWN_ERROR",
                ...(status.error?.httpStatusCode != null && {
                  httpStatusCode: status.error.httpStatusCode,
                }),
              })
            } else if (result) {
              const extracted: CachedExtraction = {
                url: result.url,
                title: result.title ?? undefined,
                content: result.text?.slice(0, 10000),
              }
              freshResults.set(url, extracted)
              setCachedExtraction(url, extracted)
            } else {
              freshErrors.set(url, { url, error: "NO_RESULT_RETURNED" })
            }
          }

          // ── Merge cached + fresh in original URL order ─
          let successCount = 0
          let failedCount = 0

          const mapped = urls.map((url) => {
            const cachedResult = cached.get(url)
            if (cachedResult) {
              successCount++
              return cachedResult
            }
            const fresh = freshResults.get(url)
            if (fresh) {
              successCount++
              return fresh
            }
            const error = freshErrors.get(url)
            if (error) {
              failedCount++
              return error
            }
            failedCount++
            return { url, error: "NO_RESULT_RETURNED" }
          })

          console.log(
            JSON.stringify({
              _tag: "tool_exec",
              tool: "extract_content",
              source: "exa",
              durationMs: Date.now() - startMs,
              urlCount: urls.length,
              successCount,
              failedCount,
              cachedCount: cached.size,
            })
          )
          return truncateToolResult(mapped, {
            toolName: "extract_content",
            resultCategory: "content_extraction",
          })
        } catch (err) {
          console.error(
            `[tools/exa] Content extraction failed after ${Date.now() - startMs}ms:`,
            err instanceof Error ? err.message : String(err)
          )
          throw enrichToolError(err, "extract_content")
        }
      },
    })
    metadata.set("extract_content", {
      displayName: "Read Page",
      source: "third-party",
      serviceName: "Exa",
      icon: "extract",
      estimatedCostPer1k: 1,
      readOnly: true,
      idempotent: true,
      openWorld: true,
    })
  } catch (err) {
    console.error(
      "[tools/third-party] Failed to load content extraction tools:",
      err
    )
  }

  return { tools: tools as ToolSet, metadata }
}
