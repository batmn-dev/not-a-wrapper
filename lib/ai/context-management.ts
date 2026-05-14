/**
 * Context Management Utilities (Anthropic Best Practices)
 *
 * Implements strategies to prevent context rot and manage long-running sessions:
 * - Context compaction (summarizing older messages)
 * - Structured note-taking (persisting important info)
 * - Token estimation
 *
 * @see https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
 * @see lib/ai/CLAUDE.md for implementation details
 */

import type { UIMessage as AIMessage } from "ai"

// ============================================================================
// Constants
// ============================================================================

/**
 * Approximate tokens per character ratio for English text.
 * Claude uses ~4 characters per token on average.
 */
const CHARS_PER_TOKEN = 4

/**
 * Default threshold for triggering context compaction (tokens).
 * Configured in .claude/settings.json
 */
export const DEFAULT_COMPACTION_THRESHOLD = 100_000

/**
 * Number of recent messages to preserve during compaction.
 */
export const DEFAULT_PRESERVE_RECENT = 10

// ============================================================================
// Types
// ============================================================================

export type ContextManagementConfig = {
  /** Token threshold before triggering compaction */
  compactionThreshold: number
  /** Number of recent messages to preserve */
  preserveRecentMessages: number
  /** File path for structured notes */
  structuredNotesFile: string
}

export type CompactionResult = {
  /** Whether compaction was performed */
  compacted: boolean
  /** Original message count */
  originalCount: number
  /** Final message count */
  finalCount: number
  /** Estimated tokens saved */
  tokensSaved: number
  /** Summary of compacted messages (if compaction occurred) */
  summary?: string
}

export type TokenEstimate = {
  /** Estimated total tokens */
  total: number
  /** Breakdown by message role */
  byRole: {
    system: number
    user: number
    assistant: number
    tool: number
  }
}

// ============================================================================
// Token Estimation
// ============================================================================

/**
 * Estimates token count for a string.
 * Uses simple character-based estimation.
 *
 * @param text - Text to estimate tokens for
 * @returns Estimated token count
 *
 * @example
 * ```ts
 * const tokens = estimateTokens("Hello, world!")
 * // Returns ~3
 * ```
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/**
 * Estimates token count for a message array with breakdown by role.
 *
 * @param messages - Array of AI SDK messages
 * @returns Token estimate with breakdown
 */
export function estimateMessageTokens(messages: AIMessage[]): TokenEstimate {
  const result: TokenEstimate = {
    total: 0,
    byRole: {
      system: 0,
      user: 0,
      assistant: 0,
      tool: 0,
    },
  }

  for (const message of messages) {
    if (!message) continue

    // In v5, messages use parts array instead of content string
    // Extract text from parts for token estimation
    let content = ""
    if (message.parts && Array.isArray(message.parts)) {
      content = message.parts
        .filter((part) => part.type === "text")
        .map((part) => (part as { type: "text"; text: string }).text)
        .join("")
    }

    const tokens = estimateTokens(content)
    result.total += tokens

    const role = message.role as keyof typeof result.byRole
    if (role in result.byRole) {
      result.byRole[role] += tokens
    }
  }

  return result
}

// ============================================================================
// Context Compaction
// ============================================================================

/**
 * Checks if context compaction should be triggered.
 *
 * @param messages - Current message array
 * @param threshold - Token threshold for compaction
 * @returns Whether compaction is needed
 */
export function shouldCompact(
  messages: AIMessage[],
  threshold: number = DEFAULT_COMPACTION_THRESHOLD
): boolean {
  const estimate = estimateMessageTokens(messages)
  return estimate.total > threshold
}

/**
 * Compacts older messages by summarizing them while preserving recent context.
 *
 * This is a placeholder implementation. In production, this would call an LLM
 * to generate a summary of the older messages.
 *
 * @param messages - Full message array
 * @param config - Compaction configuration
 * @returns Compaction result with new message array
 *
 * @example
 * ```ts
 * const { messages: compacted, summary } = await compactContext(messages, {
 *   preserveRecentMessages: 10,
 *   // summarizer would be an LLM call in production
 * })
 * ```
 *
 * TODO: Implement actual summarization using Claude Haiku for cost efficiency
 * TODO: Store summaries in Convex for retrieval
 */
export async function compactContext(
  messages: AIMessage[],
  config: Partial<ContextManagementConfig> = {}
): Promise<{ messages: AIMessage[]; result: CompactionResult }> {
  const preserveCount = config.preserveRecentMessages ?? DEFAULT_PRESERVE_RECENT
  const threshold = config.compactionThreshold ?? DEFAULT_COMPACTION_THRESHOLD

  const estimate = estimateMessageTokens(messages)

  // No compaction needed
  if (estimate.total <= threshold) {
    return {
      messages,
      result: {
        compacted: false,
        originalCount: messages.length,
        finalCount: messages.length,
        tokensSaved: 0,
      },
    }
  }

  // Split into older and recent messages
  const splitIndex = Math.max(0, messages.length - preserveCount)
  const olderMessages = messages.slice(0, splitIndex)
  const recentMessages = messages.slice(splitIndex)

  // Skip if nothing to compact
  if (olderMessages.length === 0) {
    return {
      messages,
      result: {
        compacted: false,
        originalCount: messages.length,
        finalCount: messages.length,
        tokensSaved: 0,
      },
    }
  }

  // Generate summary of older messages
  // TODO: Replace with actual LLM call using Claude Haiku
  const summary = generatePlaceholderSummary(olderMessages)
  const summaryMessage: AIMessage = {
    id: `summary-${Date.now()}`,
    role: "system",
    parts: [{ type: "text", text: `[Context Summary]\n${summary}` }],
  }

  const compactedMessages = [summaryMessage, ...recentMessages]
  const newEstimate = estimateMessageTokens(compactedMessages)

  return {
    messages: compactedMessages,
    result: {
      compacted: true,
      originalCount: messages.length,
      finalCount: compactedMessages.length,
      tokensSaved: estimate.total - newEstimate.total,
      summary,
    },
  }
}

/**
 * Placeholder summary generator.
 * In production, this would use Claude Haiku for summarization.
 */
function generatePlaceholderSummary(messages: AIMessage[]): string {
  const userMessages = messages.filter((m) => m?.role === "user")
  const assistantMessages = messages.filter((m) => m?.role === "assistant")

  return `Previous conversation context (${messages.length} messages):
- User messages: ${userMessages.length}
- Assistant responses: ${assistantMessages.length}
- Topics discussed: [TODO: Generate with LLM]
- Key decisions: [TODO: Extract with LLM]
- Action items: [TODO: Extract with LLM]

Note: This is a placeholder summary. Implement actual summarization with Claude Haiku for production use.`
}

// ============================================================================
// Structured Note-Taking
// ============================================================================

export type StructuredNote = {
  timestamp: string
  category: "discovery" | "decision" | "pattern" | "issue" | "todo"
  content: string
  metadata?: Record<string, unknown>
}

/**
 * Formats a note for writing to NOTES.md
 *
 * @param note - Note to format
 * @returns Formatted markdown string
 */
export function formatNote(note: StructuredNote): string {
  const date = new Date(note.timestamp).toISOString().split("T")[0]
  const categoryEmoji = {
    discovery: "🔍",
    decision: "✅",
    pattern: "📋",
    issue: "⚠️",
    todo: "📝",
  }

  return `- ${categoryEmoji[note.category]} **${date}** [${note.category}]: ${note.content}`
}

/**
 * Extracts actionable items from a conversation for note-taking.
 *
 * TODO: Implement with LLM to automatically extract:
 * - Decisions made
 * - Patterns discovered
 * - Issues found
 * - TODOs identified
 *
 * @param messages - Conversation messages
 * @returns Array of structured notes
 */
export async function extractNotesFromConversation(
  _messages: AIMessage[]
): Promise<StructuredNote[]> {
  // TODO: Implement with Claude Haiku
  // This would analyze the conversation and extract key information
  // to persist in NOTES.md for future reference

  return []
}

// ============================================================================
// Context Editing (API Beta Feature)
// ============================================================================

/**
 * Configuration for Anthropic's context management API.
 *
 * Enable with beta header: `context-management-2025-06-27`
 *
 * @see https://www.anthropic.com/news/context-management
 */
export const CONTEXT_MANAGEMENT_API = {
  /**
   * Beta header to enable context management features
   */
  betaHeader: "context-management-2025-06-27",

  /**
   * Beta header for token-efficient tool use
   */
  tokenEfficientToolsHeader: "token-efficient-tools-2025-02-19",

  /**
   * Beta header for 1M token context window (requires tier 4)
   */
  extendedContextHeader: "context-1m-2025-08-07",
}

/**
 * Creates headers for enabling context management API features.
 *
 * @param options - Which features to enable
 * @returns Headers object for API requests
 */
export function createContextManagementHeaders(options: {
  contextManagement?: boolean
  tokenEfficient?: boolean
  extendedContext?: boolean
}): Record<string, string> {
  const headers: Record<string, string> = {}

  const betaFeatures: string[] = []

  if (options.contextManagement) {
    betaFeatures.push(CONTEXT_MANAGEMENT_API.betaHeader)
  }

  if (options.tokenEfficient) {
    betaFeatures.push(CONTEXT_MANAGEMENT_API.tokenEfficientToolsHeader)
  }

  if (options.extendedContext) {
    betaFeatures.push(CONTEXT_MANAGEMENT_API.extendedContextHeader)
  }

  if (betaFeatures.length > 0) {
    headers["anthropic-beta"] = betaFeatures.join(",")
  }

  return headers
}
