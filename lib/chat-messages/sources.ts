import type { SourceUrlUIPart, UIMessage } from "ai"
import { isToolUIPart } from "ai"

type SourceLike = {
  url: string
  title?: string
  sourceId?: string
  description?: string
  snippet?: string
  siteName?: string
  faviconDomain?: string
  publishedDate?: string
  date?: string
  toolCallId?: string
  tool_call_id?: string
  callId?: string
  searchId?: string
  providerMetadata?: Record<string, unknown>
}

export type AssistantSourceResult = SourceUrlUIPart & {
  description?: string
  siteName?: string
  faviconDomain?: string
  publishedDate?: string
  /** Explicit producer identity when the provider/tool output supplies one. */
  toolCallId?: string
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined
}

function nestedMetadataString(
  source: SourceLike,
  keys: readonly string[]
): string | undefined {
  for (const metadata of Object.values(source.providerMetadata ?? {})) {
    if (metadata === null || typeof metadata !== "object") continue
    const record = metadata as Record<string, unknown>
    for (const key of keys) {
      const value = nonEmptyString(record[key])
      if (value) return value
    }
  }
  return undefined
}

function sourceToolCallId(source: SourceLike): string | undefined {
  const direct =
    source.toolCallId ?? source.tool_call_id ?? source.callId ?? source.searchId
  if (direct) return direct
  return nestedMetadataString(source, [
    "toolCallId",
    "tool_call_id",
    "callId",
    "searchId",
  ])
}

function sourcePublishedDate(source: SourceLike): string | undefined {
  return (
    nonEmptyString(source.publishedDate) ??
    nonEmptyString(source.date) ??
    nestedMetadataString(source, ["publishedDate", "date"])
  )
}

function normalizeSource(source: SourceLike): AssistantSourceResult {
  return {
    type: "source-url",
    sourceId: source.sourceId || source.url,
    url: source.url,
    title: nonEmptyString(source.title),
    description: source.description || source.snippet,
    siteName: source.siteName,
    faviconDomain: source.faviconDomain,
    publishedDate: sourcePublishedDate(source),
    toolCallId: sourceToolCallId(source),
  }
}

function sourceCandidates(value: unknown): SourceLike[] {
  if (Array.isArray(value)) return value.flatMap(sourceCandidates)
  if (isValidSource(value)) return [value]
  if (value === null || typeof value !== "object") return []

  const record = value as Record<string, unknown>
  return ["sources", "results", "citations", "content", "result"].flatMap(
    (key) => sourceCandidates(record[key])
  )
}

export function dedupeSources(
  sources: readonly AssistantSourceResult[]
): AssistantSourceResult[] {
  const result: AssistantSourceResult[] = []
  const indexes = new Map<string, number>()
  for (const source of sources) {
    const existingIndex = indexes.get(source.url)
    if (existingIndex === undefined) {
      indexes.set(source.url, result.length)
      result.push(source)
      continue
    }
    const existing = result[existingIndex]
    result[existingIndex] = {
      ...source,
      ...existing,
      title: existing.title ?? source.title,
      description: existing.description ?? source.description,
      siteName: existing.siteName ?? source.siteName,
      faviconDomain: existing.faviconDomain ?? source.faviconDomain,
      publishedDate: existing.publishedDate ?? source.publishedDate,
      toolCallId: existing.toolCallId ?? source.toolCallId,
    }
  }
  return result
}

/** Sources owned by one chronological part, before turn-level deduplication. */
export function getPartSources(
  part: UIMessage["parts"][number]
): AssistantSourceResult[] {
  if (part.type === "source-url") {
    return [normalizeSource(part as SourceLike)]
  }
  if (!isToolUIPart(part) || part.state !== "output-available") return []
  return dedupeSources(sourceCandidates(part.output).map(normalizeSource))
}

function isValidSource(source: unknown): source is SourceLike {
  return (
    source !== null &&
    typeof source === "object" &&
    "url" in source &&
    typeof (source as SourceLike).url === "string" &&
    (source as SourceLike).url !== ""
  )
}

export function getSources(parts: UIMessage["parts"]): AssistantSourceResult[] {
  return dedupeSources(parts.flatMap(getPartSources))
}
