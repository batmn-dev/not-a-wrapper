import type { ReplayToolExchange } from "../types"

export function synthesizeWebSearchReplayContext(
  tool: ReplayToolExchange,
  emptyResultsLabel: string
): string | null {
  const webSearch = tool.webSearch
  if (!webSearch) return null

  const queryLabel =
    webSearch.query.trim().length > 0 ? ` for "${webSearch.query}"` : ""
  if (webSearch.results.length === 0) {
    return `Replay note: web_search${queryLabel} was omitted for ${emptyResultsLabel}.`
  }

  const lines = webSearch.results.map((result) => {
    const title = result.title?.trim().length ? result.title.trim() : "Result"
    const snippet = result.snippet?.trim().length
      ? ` - ${result.snippet.trim()}`
      : ""
    return `- ${title} (${result.url})${snippet}`
  })

  return `Replay context from prior web_search${queryLabel}:\n${lines.join("\n")}`
}
