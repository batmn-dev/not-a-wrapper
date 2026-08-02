import type { UIMessage } from "ai"
import type { ReplayMessage } from "../types"
import { synthesizePlatformToolFallback } from "./platform-tool-fallback"
import { synthesizeWebSearchReplayContext } from "./web-search-context"
import type {
  ReplayCompileContext,
  ReplayCompiler,
  ReplayCompileResult,
  ReplayCompileStats,
  ReplayCompileWarning,
} from "./types"

type MessagePart = UIMessage["parts"][number]

function createStats(messages: readonly ReplayMessage[]): ReplayCompileStats {
  return {
    originalMessageCount: messages.length,
    compiledMessageCount: 0,
    droppedMessages: 0,
    totalPartsOriginal: messages.reduce(
      (sum, message) => sum + message.parts.length,
      0
    ),
    totalPartsCompiled: 0,
    toolExchangesSeen: 0,
    toolExchangesCompiled: 0,
    toolExchangesDropped: 0,
    invariantsRepaired: 0,
  }
}

function compileMessageParts(
  message: ReplayMessage,
  messageIndex: number,
  warnings: ReplayCompileWarning[],
  stats: ReplayCompileStats
): MessagePart[] {
  const nextParts: MessagePart[] = []

  message.parts.forEach((part, partIndex) => {
    if (part.type === "text") {
      nextParts.push({ type: "text", text: part.text } as MessagePart)
      return
    }

    if (part.type === "file") {
      if (part.mediaType && part.url) {
        nextParts.push({
          type: "file",
          mediaType: part.mediaType,
          filename: part.filename,
          url: part.url,
        })
        return
      }

      const label = part.filename?.trim().length
        ? part.filename
        : "attached file"
      nextParts.push({
        type: "text",
        text: `Replay note: ${label} was present in prior context.`,
      })
      stats.invariantsRepaired += 1
      return
    }

    if (part.type === "source-url") {
      nextParts.push({
        type: "text",
        text: `[Earlier cited source: ${part.title ?? "Source"} (${part.url})]`,
      } as MessagePart)
      warnings.push({
        code: "source_url_projected",
        messageIndex,
        partIndex,
        detail: "Projected source-url to replay-safe citation text.",
      })
      return
    }

    stats.toolExchangesSeen += 1
    const tool = part.tool
    if (tool.toolName === "web_search") {
      const fallbackText = synthesizeWebSearchReplayContext(
        tool,
        "Anthropic-safe replay"
      )
      if (fallbackText) {
        nextParts.push({ type: "text", text: fallbackText } as MessagePart)
        stats.toolExchangesCompiled += 1
        warnings.push({
          code: "tool_lowered_to_text",
          messageIndex,
          partIndex,
          detail:
            "Lowered web_search replay to text; the compiler never fabricates Anthropic hosted-tool payloads.",
        })
        return
      }
    }

    stats.toolExchangesDropped += 1
    const platformFallback = synthesizePlatformToolFallback(tool)
    if (platformFallback) {
      nextParts.push({ type: "text", text: platformFallback } as MessagePart)
    }
    warnings.push({
      code: "tool_non_replayable",
      messageIndex,
      partIndex,
      detail:
        tool.nonReplayableReason ??
        `Dropped unsupported replay tool "${tool.toolName}" for Anthropic compiler`,
    })
  })

  if (nextParts.length === 0) {
    nextParts.push({ type: "text", text: "" } as MessagePart)
    warnings.push({
      code: "message_empty_fallback",
      messageIndex,
      detail:
        "Injected empty text fallback because no Anthropic-safe parts remained",
    })
  }

  return nextParts
}

export const anthropicReplayCompiler: ReplayCompiler = {
  providerId: "anthropic",
  compileReplay(
    messages: readonly ReplayMessage[],
    _context: ReplayCompileContext
  ): ReplayCompileResult {
    const stats = createStats(messages)
    const warnings: ReplayCompileWarning[] = []

    const compiled = messages.map((message, messageIndex) => {
      const role = message.role === "tool" ? "assistant" : message.role
      if (message.role === "tool") {
        warnings.push({
          code: "tool_dropped_invalid_role",
          messageIndex,
          detail:
            "Converted tool role message to assistant for Anthropic-safe replay",
        })
        stats.invariantsRepaired += 1
      }

      return {
        id: message.id,
        role,
        parts: compileMessageParts(message, messageIndex, warnings, stats),
      } as UIMessage
    })

    stats.compiledMessageCount = compiled.length
    stats.droppedMessages = Math.max(
      0,
      stats.originalMessageCount - stats.compiledMessageCount
    )
    stats.totalPartsCompiled = compiled.reduce(
      (sum, message) => sum + message.parts.length,
      0
    )

    return { messages: compiled, warnings, stats }
  },
}
