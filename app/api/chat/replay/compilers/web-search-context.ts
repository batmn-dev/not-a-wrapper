import type { ReplayToolExchange } from "../types"

export type WebSearchReplayContextLimits = {
  maxResults: number
  maxQueryChars: number
  maxTitleChars: number
  maxUrlChars: number
  maxSnippetChars: number
}

function truncateText(value: string, maxChars: number): string {
  const trimmed = value.trim()
  if (trimmed.length <= maxChars) return trimmed
  if (maxChars <= 1) return "…".slice(0, Math.max(0, maxChars))
  return `${trimmed.slice(0, maxChars - 1).trimEnd()}…`
}

export function synthesizeWebSearchReplayContext(
  tool: ReplayToolExchange,
  emptyResultsLabel: string,
  limits?: WebSearchReplayContextLimits
): string | null {
  const webSearch = tool.webSearch
  if (!webSearch) return null

  const query = limits
    ? truncateText(webSearch.query, limits.maxQueryChars)
    : webSearch.query.trim()
  const queryLabel = query.length > 0 ? ` for "${query}"` : ""
  if (webSearch.results.length === 0) {
    return `Replay note: web_search${queryLabel} was omitted for ${emptyResultsLabel}.`
  }

  const projectedResults = limits
    ? webSearch.results.slice(0, limits.maxResults)
    : webSearch.results
  const lines = projectedResults.map((result) => {
    const rawTitle = result.title?.trim().length
      ? result.title.trim()
      : "Result"
    const title = limits
      ? truncateText(rawTitle, limits.maxTitleChars)
      : rawTitle
    const url = limits
      ? truncateText(result.url, limits.maxUrlChars)
      : result.url
    const rawSnippet = result.snippet?.trim() ?? ""
    const snippetText = limits
      ? truncateText(rawSnippet, limits.maxSnippetChars)
      : rawSnippet
    const snippet = snippetText.length ? ` - ${snippetText}` : ""
    return `- ${title} (${url})${snippet}`
  })

  const omittedResultCount = webSearch.results.length - projectedResults.length
  const omissionNote =
    omittedResultCount > 0
      ? `\n[${omittedResultCount} additional web_search result${omittedResultCount === 1 ? "" : "s"} omitted from replay.]`
      : ""

  return `Replay context from prior web_search${queryLabel}:\n${lines.join("\n")}${omissionNote}`
}
