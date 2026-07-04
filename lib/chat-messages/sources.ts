/**
 * Source extraction from message parts — one half of the Assistant turn view
 * derivation (see ./assistant-turn.ts and CONTEXT.md "Assistant turn view").
 * Moved from app/components/chat/get-sources.ts so the view module (and any
 * server-adjacent consumer, e.g. the share page) can derive sources without
 * importing from the component tree.
 */
import type { SourceUrlUIPart, UIMessage } from "ai"
import { getStaticToolName, isStaticToolUIPart } from "ai"

// Source type for validation
type SourceLike = {
  url: string
  title?: string
  sourceId?: string
}

// Type guard to check if an object is a valid source
function isValidSource(source: unknown): source is SourceLike {
  return (
    source !== null &&
    typeof source === "object" &&
    "url" in source &&
    typeof (source as SourceLike).url === "string" &&
    (source as SourceLike).url !== ""
  )
}

export function getSources(parts: UIMessage["parts"]): SourceUrlUIPart[] {
  const sources = parts
    ?.filter((part) => part.type === "source-url" || isStaticToolUIPart(part))
    .map((part) => {
      if (part.type === "source-url") {
        return part // In v6, the source-url part IS the source object
      }

      // v6: Tool parts use flat properties - use part.state, part.output, etc.
      if (isStaticToolUIPart(part) && part.state === "output-available") {
        const result = part.output as unknown
        const toolName = getStaticToolName(part)

        // Handle summarizeSources tool which returns citations
        if (toolName === "summarizeSources") {
          const typedResult = result as
            { result?: Array<{ citations?: unknown[] }> } | undefined
          if (typedResult?.result?.[0]?.citations) {
            return typedResult.result.flatMap((item) => item.citations || [])
          }
        }

        return Array.isArray(result) ? result.flat() : result
      }

      return null
    })
    .filter(Boolean)
    .flat()

  // Filter and convert to SourceUrlUIPart format
  const validSources = (sources || [])
    .filter(isValidSource)
    .map((source): SourceUrlUIPart => ({
      type: "source-url",
      sourceId: source.sourceId || source.url,
      url: source.url,
      title: source.title || source.url,
    }))

  // Dedupe by URL, keeping the first occurrence. Providers cite the same URL
  // across multiple source parts / tool steps; this derivation feeds every
  // consumer (gallery rows, "Sources · N" labels, trigger counts), so the
  // dedupe lives here rather than in any one renderer.
  const seenUrls = new Set<string>()
  return validSources.filter((source) => {
    if (seenUrls.has(source.url)) return false
    seenUrls.add(source.url)
    return true
  })
}
