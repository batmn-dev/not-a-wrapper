import type { UIMessage } from "ai"
import {
  createEmptyStats,
  detectSourceProvider,
  incrementStat,
  isToolPart,
  isToolPartFinal,
  stripCallProviderMetadata,
  type AdaptationResult,
  type AdaptationWarning,
  type ProviderHistoryAdapter,
} from "./types"

type WebSearchResult = {
  url: string
  title?: string
  snippet?: string
  pageAge?: string | null
  encryptedContent?: string
  resultType?: "web_search_result"
}

function isToolInvocationPart(part: Record<string, unknown>): boolean {
  const state = typeof part.state === "string" ? part.state : ""
  return state.startsWith("input-") || "input" in part
}

function isToolResultPart(part: Record<string, unknown>): boolean {
  const state = typeof part.state === "string" ? part.state : ""
  return state.startsWith("output-") || "output" in part
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object"
}

function toWebSearchResult(item: unknown): WebSearchResult | null {
  if (!isRecord(item)) return null
  if (typeof item.url !== "string" || item.url.length === 0) return null

  let snippet: string | undefined
  if (typeof item.snippet === "string") snippet = item.snippet
  else if (typeof item.content === "string") snippet = item.content
  else if (typeof item.text === "string") snippet = item.text

  return {
    url: item.url,
    title: typeof item.title === "string" ? item.title : undefined,
    snippet,
    pageAge:
      typeof item.pageAge === "string"
        ? item.pageAge
        : typeof item.page_age === "string"
          ? item.page_age
          : item.pageAge === null || item.page_age === null
            ? null
            : undefined,
    encryptedContent:
      typeof item.encryptedContent === "string"
        ? item.encryptedContent
        : undefined,
    resultType:
      item.type === "web_search_result" ? "web_search_result" : undefined,
  }
}

function extractWebSearchResults(output: unknown): WebSearchResult[] {
  if (Array.isArray(output)) {
    return output
      .map(toWebSearchResult)
      .filter((result): result is WebSearchResult => result !== null)
  }

  if (isRecord(output) && Array.isArray(output.sources)) {
    return output.sources
      .map(toWebSearchResult)
      .filter((result): result is WebSearchResult => result !== null)
  }

  if (isRecord(output) && Array.isArray(output.results)) {
    return output.results
      .map(toWebSearchResult)
      .filter((result): result is WebSearchResult => result !== null)
  }

  return []
}

function isAnthropicNativeWebSearchResult(result: WebSearchResult): boolean {
  return (
    result.resultType === "web_search_result" &&
    typeof result.encryptedContent === "string" &&
    result.encryptedContent.length > 0
  )
}

function buildWebSearchReplayFallbackText(
  part: Record<string, unknown>
): string {
  const query =
    isRecord(part.input) && typeof part.input.query === "string"
      ? part.input.query.trim()
      : ""
  const queryLabel = query.length > 0 ? ` for "${query}"` : ""
  const results = extractWebSearchResults(part.output)

  if (results.length === 0) {
    return `Replay note: web_search${queryLabel} was omitted for Anthropic-safe replay.`
  }

  const lines = results.slice(0, 3).map((result) => {
    const title = result.title?.trim().length ? result.title.trim() : "Result"
    const snippet = result.snippet?.trim().length
      ? ` - ${result.snippet.trim()}`
      : ""
    return `- ${title} (${result.url})${snippet}`
  })

  return `Replay context from prior web_search${queryLabel}:\n${lines.join("\n")}`
}

/**
 * Anthropic web_search tool expects output as an array of search results.
 * OpenAI replay history can contain object-shaped output like { action, sources }.
 * Coerce known object shapes to an array to avoid cross-provider validation failures.
 */
function normalizeWebSearchOutputForAnthropic(part: Record<string, unknown>): {
  part: Record<string, unknown>
  transformed: boolean
} {
  if (part.type !== "tool-web_search") {
    return { part, transformed: false }
  }

  const normalizedResults = extractWebSearchResults(part.output)
  const hasNativeAnthropicPayload =
    normalizedResults.length > 0 &&
    normalizedResults.every(isAnthropicNativeWebSearchResult)

  if (!hasNativeAnthropicPayload) {
    return {
      part: {
        type: "text",
        text: buildWebSearchReplayFallbackText(part),
      },
      transformed: true,
    }
  }

  return {
    part: {
      ...part,
      output: normalizedResults.map((result) => ({
        url: result.url,
        title: result.title ?? null,
        pageAge: result.pageAge ?? null,
        encryptedContent: result.encryptedContent,
        type: "web_search_result" as const,
      })),
    },
    transformed: true,
  }
}

function warnForOrphanedToolPairs(
  warnings: AdaptationWarning[],
  messageIndex: number,
  parts: Array<Record<string, unknown>>
): void {
  const invocationCounts = new Map<string, number>()
  const resultCounts = new Map<string, number>()

  for (const part of parts) {
    const toolCallId =
      typeof part.toolCallId === "string" ? part.toolCallId : null
    if (!toolCallId) continue

    if (isToolInvocationPart(part)) {
      invocationCounts.set(
        toolCallId,
        (invocationCounts.get(toolCallId) ?? 0) + 1
      )
    }
    if (isToolResultPart(part)) {
      resultCounts.set(toolCallId, (resultCounts.get(toolCallId) ?? 0) + 1)
    }
  }

  for (const [toolCallId, invocationCount] of invocationCounts) {
    const resultCount = resultCounts.get(toolCallId) ?? 0
    if (invocationCount !== resultCount) {
      warnings.push({
        code: "incomplete_triple_dropped",
        messageIndex,
        detail: `Orphaned tool pair detected for toolCallId "${toolCallId}" (${invocationCount} invocation(s), ${resultCount} result(s))`,
      })
    }
  }

  for (const [toolCallId, resultCount] of resultCounts) {
    const invocationCount = invocationCounts.get(toolCallId) ?? 0
    if (invocationCount === 0 && resultCount > 0) {
      warnings.push({
        code: "incomplete_triple_dropped",
        messageIndex,
        detail: `Orphaned tool result detected for toolCallId "${toolCallId}" (${resultCount} result(s), no invocation)`,
      })
    }
  }
}

export const anthropicAdapter: ProviderHistoryAdapter = {
  providerId: "anthropic",
  metadata: {
    droppedPartTypes: new Set(["step-start"]),
    transformedPartTypes: new Set(),
    tier: "standard",
    description:
      "Anthropic near-passthrough - API auto-manages thinking lifecycle",
  },
  async adaptMessages(messages, _context): Promise<AdaptationResult> {
    const totalPartsOriginal = messages.reduce(
      (sum, message) => sum + message.parts.length,
      0
    )
    const stats = createEmptyStats(messages.length, totalPartsOriginal)
    const warnings: AdaptationWarning[] = []
    const adapted: UIMessage[] = []

    for (const [messageIndex, message] of messages.entries()) {
      const nextParts: Array<Record<string, unknown>> = []
      const role = (message as { role?: string }).role

      for (const part of message.parts) {
        const mutablePart = part as Record<string, unknown>
        const partType =
          typeof mutablePart.type === "string" ? mutablePart.type : "unknown"

        if (isToolPart({ type: partType }) && !isToolPartFinal(mutablePart)) {
          incrementStat(stats.partsDropped, partType)
          warnings.push({
            code: "non_final_state_dropped",
            messageIndex,
            detail: `Dropped non-final tool state "${String(mutablePart.state ?? "unknown")}"`,
          })
          continue
        }

        if (partType === "step-start") {
          incrementStat(stats.partsDropped, partType)
          continue
        }

        let nextPart = mutablePart
        if ("callProviderMetadata" in nextPart) {
          const sourceProvider = detectSourceProvider(nextPart)
          if (sourceProvider && sourceProvider !== "anthropic") {
            nextPart = stripCallProviderMetadata(nextPart)
            stats.providerIdsStripped += 1
            incrementStat(stats.partsTransformed, partType)
            warnings.push({
              code: "provider_ids_stripped",
              messageIndex,
              detail: `Stripped callProviderMetadata from "${sourceProvider}" for Anthropic replay`,
            })
          }
        }

        const normalizedToolPart =
          normalizeWebSearchOutputForAnthropic(nextPart)
        if (normalizedToolPart.transformed) {
          nextPart = normalizedToolPart.part
          incrementStat(stats.partsTransformed, partType)
        }

        nextParts.push(nextPart)
        incrementStat(stats.partsPreserved, partType)
      }

      if (role === "assistant") {
        warnForOrphanedToolPairs(warnings, messageIndex, nextParts)
      }

      if (nextParts.length === 0) {
        incrementStat(stats.partsDropped, "message-empty")
        warnings.push({
          code: "empty_message_fallback",
          messageIndex,
          detail:
            "Injected empty text fallback because all message parts were removed",
        })
        nextParts.push({ type: "text", text: "" })
        incrementStat(stats.partsTransformed, "fallback-text")
      }

      adapted.push({
        ...message,
        parts: nextParts as UIMessage["parts"],
      })
    }

    stats.adaptedMessageCount = adapted.length
    stats.droppedMessages = Math.max(
      0,
      stats.originalMessageCount - adapted.length
    )
    stats.totalPartsAdapted = adapted.reduce(
      (sum, message) => sum + message.parts.length,
      0
    )

    return {
      messages: adapted,
      stats,
      warnings,
    }
  },
}
