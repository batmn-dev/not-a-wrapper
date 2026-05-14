import type { UIMessage } from "ai"
import { z } from "zod"
import type { ReplayMessage, ReplayToolExchange } from "../types"
import { synthesizePlatformToolFallback } from "./platform-tool-fallback"
import type {
  ReplayCompileResult,
  ReplayCompileContext,
  ReplayCompileStats,
  ReplayCompileWarning,
  ReplayCompiler,
} from "./index"

type MessagePart = UIMessage["parts"][number]

const anthropicSearchResultSchema = z.object({
  url: z.string().min(1),
  title: z.string().nullable(),
  pageAge: z.string().nullable(),
  encryptedContent: z.string().min(1),
  type: z.literal("web_search_result"),
})

const anthropicToolPartSchema = z.object({
  type: z.literal("tool-web_search"),
  state: z.literal("output-available"),
  toolName: z.literal("web_search"),
  toolCallId: z.string().min(1),
  providerExecuted: z.boolean(),
  input: z.object({
    query: z.string(),
  }),
  output: z.array(anthropicSearchResultSchema),
})

const textPartSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
})

function createStats(messages: readonly ReplayMessage[]): ReplayCompileStats {
  return {
    originalMessageCount: messages.length,
    compiledMessageCount: 0,
    droppedMessages: 0,
    totalPartsOriginal: messages.reduce((sum, message) => sum + message.parts.length, 0),
    totalPartsCompiled: 0,
    toolExchangesSeen: 0,
    toolExchangesCompiled: 0,
    toolExchangesDropped: 0,
    invariantsRepaired: 0,
  }
}

function synthesizeWebSearchFallback(tool: ReplayToolExchange): string | null {
  const webSearch = tool.webSearch
  if (!webSearch) return null

  const queryLabel = webSearch.query.trim().length > 0 ? ` for "${webSearch.query}"` : ""
  if (webSearch.results.length === 0) {
    return `Replay note: web_search${queryLabel} was omitted for Anthropic-safe replay.`
  }

  const lines = webSearch.results.slice(0, 3).map((result) => {
    const title = result.title?.trim().length ? result.title.trim() : "Result"
    const snippet = result.snippet?.trim().length ? ` - ${result.snippet.trim()}` : ""
    return `- ${title} (${result.url})${snippet}`
  })

  return `Replay context from prior web_search${queryLabel}:\n${lines.join("\n")}`
}

function compileWebSearchToolPart(tool: ReplayToolExchange, messageId: string, partIndex: number) {
  if (!tool.webSearch) return null

  const hasNativeAnthropicResults = tool.webSearch.results.every(
    (result) =>
      result.resultType === "web_search_result" &&
      typeof result.encryptedContent === "string" &&
      result.encryptedContent.length > 0,
  )
  if (!hasNativeAnthropicResults) return null

  const toolCallId =
    typeof tool.toolCallId === "string" && tool.toolCallId.length > 0
      ? tool.toolCallId
      : `${messageId}-web-search-${partIndex}`

  const candidate = {
    type: "tool-web_search",
    state: "output-available",
    toolName: "web_search",
    toolCallId,
    providerExecuted: true,
    input: { query: tool.webSearch.query },
    output: tool.webSearch.results.map((result) => ({
      url: result.url,
      title: result.title ?? null,
      pageAge: result.pageAge ?? null,
      encryptedContent: result.encryptedContent,
      type: result.resultType,
    })),
  }

  const parsed = anthropicToolPartSchema.safeParse(candidate)
  return parsed.success ? (parsed.data as MessagePart) : null
}

function compileMessageParts(
  message: ReplayMessage,
  messageIndex: number,
  warnings: ReplayCompileWarning[],
  stats: ReplayCompileStats,
): MessagePart[] {
  const nextParts: MessagePart[] = []

  message.parts.forEach((part, partIndex) => {
    if (part.type !== "tool-exchange") {
      if (part.type === "text") {
        const validatedPart = textPartSchema.safeParse(part)
        if (!validatedPart.success) {
          stats.invariantsRepaired += 1
          warnings.push({
            code: "invariant_block_dropped",
            messageIndex,
            partIndex,
            detail: `Dropped invalid compiled part of type "${part.type}"`,
          })
          return
        }

        nextParts.push(validatedPart.data as MessagePart)
        return
      }

      if (part.type === "source-url") {
        warnings.push({
          code: "source_url_dropped",
          messageIndex,
          partIndex,
          detail: "Dropped source-url part for Anthropic-safe replay.",
        })
        return
      }

      if (part.type === "file") {
        const label = part.filename?.trim().length ? part.filename : "attached file"
        nextParts.push({
          type: "text",
          text: `Replay note: ${label} was present in prior context.`,
        } as MessagePart)
        stats.invariantsRepaired += 1
        warnings.push({
          code: "invariant_reasoning_injected",
          messageIndex,
          partIndex,
          detail: "Converted file part to text for Anthropic-safe replay",
        })
        return
      }

      {
        const unsupportedPartType = (part as { type?: string }).type ?? "unknown"
        stats.invariantsRepaired += 1
        warnings.push({
          code: "invariant_block_dropped",
          messageIndex,
          partIndex,
          detail: `Dropped unsupported replay part "${unsupportedPartType}"`,
        })
        return
      }
    }

    const tool = part.tool
    stats.toolExchangesSeen += 1

    if (tool.toolName !== "web_search") {
      stats.toolExchangesDropped += 1

      const platformFallback = synthesizePlatformToolFallback(tool)
      if (platformFallback) {
        nextParts.push({ type: "text", text: platformFallback } as MessagePart)
      }

      warnings.push({
        code: "tool_non_replayable",
        messageIndex,
        partIndex,
        detail: platformFallback
          ? `Dropped platform tool "${tool.toolName}" with continuity summary for Anthropic compiler`
          : `Dropped unsupported replay tool "${tool.toolName}" for Anthropic compiler`,
      })
      return
    }

    if (!tool.replayable || !tool.webSearch) {
      stats.toolExchangesDropped += 1
      warnings.push({
        code: "tool_non_replayable",
        messageIndex,
        partIndex,
        detail: tool.nonReplayableReason ?? "web_search payload is non-replayable",
      })

      const fallbackText = synthesizeWebSearchFallback(tool)
      if (fallbackText) {
        nextParts.push({ type: "text", text: fallbackText } as MessagePart)
      }
      return
    }

    const compiledPart = compileWebSearchToolPart(tool, message.id, partIndex)
    if (!compiledPart) {
      stats.toolExchangesDropped += 1
      stats.invariantsRepaired += 1
      warnings.push({
        code: "invariant_block_dropped",
        messageIndex,
        partIndex,
        detail: "Dropped web_search replay part because Anthropic output validation failed",
      })

      const fallbackText = synthesizeWebSearchFallback(tool)
      if (fallbackText) {
        nextParts.push({ type: "text", text: fallbackText } as MessagePart)
      }
      return
    }

    nextParts.push(compiledPart)
    stats.toolExchangesCompiled += 1
  })

  if (nextParts.length === 0) {
    nextParts.push({ type: "text", text: "" } as MessagePart)
    warnings.push({
      code: "message_empty_fallback",
      messageIndex,
      detail: "Injected empty text fallback because no Anthropic-safe parts remained",
    })
  }

  return nextParts
}

function validateCompiledMessage(
  message: UIMessage,
  messageIndex: number,
  warnings: ReplayCompileWarning[],
  stats: ReplayCompileStats,
): UIMessage {
  const validatedParts: MessagePart[] = []

  message.parts.forEach((part, partIndex) => {
    const toolCheck =
      part.type === "tool-web_search" ? anthropicToolPartSchema.safeParse(part).success : true
    const textCheck = part.type === "text" ? textPartSchema.safeParse(part).success : true
    if (toolCheck && textCheck) {
      validatedParts.push(part)
      return
    }

    stats.invariantsRepaired += 1
    warnings.push({
      code: "invariant_block_dropped",
      messageIndex,
      partIndex,
      detail: `Dropped invalid part during Anthropic output validation (${part.type})`,
    })
  })

  if (validatedParts.length === 0) {
    validatedParts.push({ type: "text", text: "" } as MessagePart)
    warnings.push({
      code: "message_empty_fallback",
      messageIndex,
      detail: "Injected empty text fallback after Anthropic output validation",
    })
  }

  return {
    ...message,
    parts: validatedParts,
  }
}

export const anthropicReplayCompiler: ReplayCompiler = {
  providerId: "anthropic",
  compileReplay(
    messages: readonly ReplayMessage[],
    _context: ReplayCompileContext,
  ): ReplayCompileResult {
    const stats = createStats(messages)
    const warnings: ReplayCompileWarning[] = []

    const compiled = messages.map((message, messageIndex) => {
      const role = message.role === "tool" ? "assistant" : message.role
      if (message.role === "tool") {
        warnings.push({
          code: "tool_dropped_invalid_role",
          messageIndex,
          detail: "Converted tool role message to assistant for Anthropic-safe replay",
        })
        stats.invariantsRepaired += 1
      }

      const compiledMessage: UIMessage = {
        id: message.id,
        role,
        parts: compileMessageParts(message, messageIndex, warnings, stats),
      }
      return validateCompiledMessage(compiledMessage, messageIndex, warnings, stats)
    })

    stats.compiledMessageCount = compiled.length
    stats.droppedMessages = Math.max(0, stats.originalMessageCount - stats.compiledMessageCount)
    stats.totalPartsCompiled = compiled.reduce((sum, message) => sum + message.parts.length, 0)

    return {
      messages: compiled,
      warnings,
      stats,
    }
  },
}
