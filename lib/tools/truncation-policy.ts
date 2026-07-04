export type TruncationCategory =
  "default" | "generic" | "search_results" | "content_extraction" | "plain_text"

export type TruncationContext = {
  toolName?: string
  resultCategory?: TruncationCategory
}

type TruncationStrategy = {
  id: string
  keyPriority: string[]
  arraySelector: "head" | "scored"
  stringHint: string
  arrayHint: string
  objectHint: string
}

export type ResolvedTruncationStrategy = TruncationStrategy

const DEFAULT_KEY_PRIORITY = [
  "error",
  "errors",
  "message",
  "hint",
  "title",
  "url",
  "content",
  "summary",
  "snippet",
  "id",
  "name",
  "status",
  "publishedDate",
  "date",
]

const DEFAULT_STRATEGY: TruncationStrategy = {
  id: "default",
  keyPriority: DEFAULT_KEY_PRIORITY,
  arraySelector: "scored",
  stringHint:
    "Use a narrower query or ask for a specific section to retrieve complete text.",
  arrayHint:
    "Request fewer items or add tighter filters to retrieve the full result set.",
  objectHint:
    "Request specific fields instead of the full object to retrieve complete details.",
}

const CATEGORY_STRATEGIES: Record<TruncationCategory, TruncationStrategy> = {
  default: DEFAULT_STRATEGY,
  generic: DEFAULT_STRATEGY,
  search_results: {
    id: "search_results",
    keyPriority: [
      "error",
      "title",
      "url",
      "content",
      "summary",
      "snippet",
      "publishedDate",
      "source",
      ...DEFAULT_KEY_PRIORITY,
    ],
    arraySelector: "head",
    stringHint:
      "Refine the search query, add date/site filters, or request fewer results.",
    arrayHint:
      "Ask for fewer results or add filters (site, date, topic) to retrieve complete items.",
    objectHint:
      "Ask for specific search fields (title/url/content) instead of the full payload.",
  },
  content_extraction: {
    id: "content_extraction",
    keyPriority: [
      "error",
      "url",
      "title",
      "content",
      "excerpt",
      "summary",
      ...DEFAULT_KEY_PRIORITY,
    ],
    arraySelector: "head",
    stringHint:
      "Ask for a specific section or shorter excerpt from the page content.",
    arrayHint:
      "Request fewer URLs per call or split extraction into smaller batches.",
    objectHint:
      "Request only required fields (url/title/content excerpt) for each page.",
  },
  plain_text: {
    id: "plain_text",
    keyPriority: DEFAULT_KEY_PRIORITY,
    arraySelector: "scored",
    stringHint:
      "Ask for a specific section, paragraph range, or shorter format.",
    arrayHint:
      "Request fewer entries or a paginated subset to avoid truncation.",
    objectHint:
      "Request specific fields to reduce payload size and avoid truncation.",
  },
}

const TOOL_STRATEGIES: Record<string, TruncationStrategy> = {
  web_search: CATEGORY_STRATEGIES.search_results,
  extract_content: CATEGORY_STRATEGIES.content_extraction,
}

function dedupePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const value of values) {
    const normalized = value.trim()
    if (!normalized) continue
    const lower = normalized.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)
    output.push(normalized)
  }
  return output
}

function withDefaultKeyPriority(
  strategy: TruncationStrategy
): TruncationStrategy {
  return {
    ...strategy,
    keyPriority: dedupePreserveOrder([
      ...strategy.keyPriority,
      ...DEFAULT_KEY_PRIORITY,
    ]),
  }
}

const RESOLVED_CATEGORY_STRATEGIES = Object.fromEntries(
  Object.entries(CATEGORY_STRATEGIES).map(([category, strategy]) => [
    category,
    withDefaultKeyPriority(strategy),
  ])
) as Record<TruncationCategory, TruncationStrategy>

const RESOLVED_TOOL_STRATEGIES = Object.fromEntries(
  Object.entries(TOOL_STRATEGIES).map(([toolName, strategy]) => [
    toolName,
    withDefaultKeyPriority(strategy),
  ])
) as Record<string, TruncationStrategy>

export function resolveTruncationStrategy(
  context?: TruncationContext
): ResolvedTruncationStrategy {
  const byTool = context?.toolName
    ? RESOLVED_TOOL_STRATEGIES[context.toolName]
    : undefined
  const byCategory = context?.resultCategory
    ? RESOLVED_CATEGORY_STRATEGIES[context.resultCategory]
    : undefined
  return byTool ?? byCategory ?? RESOLVED_CATEGORY_STRATEGIES.default
}

export function findSemanticBoundary(text: string, maxChars: number): number {
  if (maxChars <= 0) return 0
  if (text.length <= maxChars) return text.length

  const hardLimit = Math.max(1, Math.min(maxChars, text.length))
  const windowStart = Math.max(0, hardLimit - 300)
  const chunk = text.slice(windowStart, hardLimit)

  const paragraphMarkers = ["\n\n", "\r\n\r\n"] as const
  let paragraphBreak = -1
  let paragraphBreakLength = 0
  for (const marker of paragraphMarkers) {
    const idx = chunk.lastIndexOf(marker)
    if (
      idx > paragraphBreak ||
      (idx === paragraphBreak && marker.length > paragraphBreakLength)
    ) {
      paragraphBreak = idx
      paragraphBreakLength = marker.length
    }
  }
  if (paragraphBreak >= 0) {
    return windowStart + paragraphBreak + paragraphBreakLength
  }

  const sentenceBreakers = [". ", "! ", "? ", ".\n", "!\n", "?\n"]
  let bestSentenceBreak = -1
  for (const marker of sentenceBreakers) {
    const idx = chunk.lastIndexOf(marker)
    if (idx > bestSentenceBreak) bestSentenceBreak = idx
  }
  if (bestSentenceBreak >= 0) {
    return windowStart + bestSentenceBreak + 1
  }

  const lineBreak = chunk.lastIndexOf("\n")
  if (lineBreak >= 0) {
    return windowStart + lineBreak + 1
  }

  const spaceBreak = chunk.lastIndexOf(" ")
  if (spaceBreak >= 0) {
    return windowStart + spaceBreak
  }

  return hardLimit
}

export function scoreArrayItem(
  item: unknown,
  index: number,
  strategy: ResolvedTruncationStrategy
): number {
  // Keep earlier items favored for tools where ranking/order carries semantics.
  if (strategy.arraySelector === "head") {
    return 1_000_000 - index
  }

  const indexBonus = Math.max(0, 10_000 - index)

  if (item === null || item === undefined) return indexBonus
  if (typeof item === "string") {
    // Slightly prefer shorter text snippets under tight budgets.
    return indexBonus + Math.max(0, 2_000 - item.length)
  }
  if (typeof item !== "object") return indexBonus + 500

  const asRecord = item as Record<string, unknown>
  let score = indexBonus
  const keys = Object.keys(asRecord)
  for (const [priorityIndex, key] of strategy.keyPriority.entries()) {
    if (Object.prototype.hasOwnProperty.call(asRecord, key)) {
      score += Math.max(10, 500 - priorityIndex * 15)
    }
  }

  // Strongly prefer result rows that include explicit failures so the model can recover.
  if ("error" in asRecord || "errors" in asRecord) {
    score += 800
  }
  if ("url" in asRecord) score += 300
  if ("title" in asRecord) score += 250
  if ("content" in asRecord) score += 200

  // Prefer concise records over very large entries under budget pressure.
  score -= keys.length * 5
  return score
}
