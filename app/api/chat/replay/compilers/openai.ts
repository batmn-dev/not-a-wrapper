import type { UIMessage } from "ai"
import type { ReplayMessage, ReplayPart } from "../types"
import { synthesizePlatformToolFallback } from "./platform-tool-fallback"
import type {
  ReplayCompileContext,
  ReplayCompiler,
  ReplayCompileResult,
  ReplayCompileStats,
  ReplayCompileWarning,
} from "./types"
import { synthesizeWebSearchReplayContext } from "./web-search-context"

type MessagePart = UIMessage["parts"][number]

const OPENAI_WEB_SEARCH_REPLAY_LIMITS = {
  maxResults: 3,
  maxQueryChars: 512,
  maxTitleChars: 512,
  maxUrlChars: 2_048,
  maxSnippetChars: 2_000,
} as const

// OpenAI web_search replay is LOWERED to provider-neutral text, never
// reconstructed as a hosted tool part: the installed @ai-sdk/openai Responses
// conversion turns provider-executed tool results into server-side
// `item_reference` lookups keyed by item id, so a fabricated or foreign
// toolCallId (srvtoolu_/replay_ws_) is a guaranteed 400 — and genuine ws_ ids
// trip the runtime's provider-linked-id plaintext fallback anyway. Text
// context with citations is the only replay shape that reliably reaches the
// model.

function compileAssistantParts(
  parts: ReplayPart[],
  messageIndex: number,
  warnings: ReplayCompileWarning[],
  stats: ReplayCompileStats
): MessagePart[] {
  const compiled: MessagePart[] = []

  parts.forEach((part, partIndex) => {
    if (part.type === "text") {
      compiled.push({ type: "text", text: part.text } as MessagePart)
      return
    }

    if (part.type === "file") {
      compiled.push({
        type: "file",
        mediaType: part.mediaType,
        filename: part.filename,
        url: part.url,
      } as MessagePart)
      return
    }

    if (part.type === "source-url") {
      compiled.push({
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

    if (tool.replayable && tool.toolName === "web_search" && tool.webSearch) {
      const contextText = synthesizeWebSearchReplayContext(
        tool,
        "OpenAI-safe replay",
        OPENAI_WEB_SEARCH_REPLAY_LIMITS
      )
      if (contextText) {
        compiled.push({ type: "text", text: contextText } as MessagePart)
        stats.toolExchangesCompiled += 1
        warnings.push({
          code: "tool_lowered_to_text",
          messageIndex,
          partIndex,
          detail:
            "Lowered web_search replay to text context for OpenAI (hosted-tool activity does not replay as tool parts).",
        })
        return
      }
    }

    stats.toolExchangesDropped += 1

    const platformFallback = synthesizePlatformToolFallback(tool)
    if (platformFallback) {
      compiled.push({ type: "text", text: platformFallback } as MessagePart)
    }

    warnings.push({
      code: "tool_non_replayable",
      messageIndex,
      partIndex,
      detail:
        tool.nonReplayableReason ??
        `Tool "${tool.toolName}" is not replayable for OpenAI.`,
    })
  })

  return compiled
}

function compileMessage(
  message: ReplayMessage,
  messageIndex: number,
  warnings: ReplayCompileWarning[],
  stats: ReplayCompileStats
): UIMessage {
  if (message.role !== "assistant") {
    const nonAssistantParts: MessagePart[] = []
    message.parts.forEach((part, partIndex) => {
      if (part.type === "tool-exchange") {
        warnings.push({
          code: "tool_dropped_invalid_role",
          messageIndex,
          partIndex,
          detail: `Dropped tool replay from non-assistant role "${message.role}".`,
        })
        stats.toolExchangesDropped += 1
        return
      }

      if (part.type === "text") {
        nonAssistantParts.push({ type: "text", text: part.text } as MessagePart)
        return
      }

      if (part.type === "file") {
        nonAssistantParts.push({
          type: "file",
          mediaType: part.mediaType,
          filename: part.filename,
          url: part.url,
        } as MessagePart)
        return
      }

      if (part.type === "source-url") {
        nonAssistantParts.push({
          type: "text",
          text: `[Earlier cited source: ${part.title ?? "Source"} (${part.url})]`,
        } as MessagePart)
        warnings.push({
          code: "source_url_projected",
          messageIndex,
          partIndex,
          detail: "Projected source-url to replay-safe citation text.",
        })
      }
    })

    const role = message.role === "tool" ? "assistant" : message.role
    if (nonAssistantParts.length === 0) {
      stats.invariantsRepaired += 1
    }

    return {
      id: message.id,
      role,
      parts:
        nonAssistantParts.length > 0
          ? nonAssistantParts
          : ([{ type: "text", text: "" }] as MessagePart[]),
    } as UIMessage
  }

  const assistantCompiled = compileAssistantParts(
    message.parts,
    messageIndex,
    warnings,
    stats
  )
  if (assistantCompiled.length === 0) {
    warnings.push({
      code: "message_empty_fallback",
      messageIndex,
      detail:
        "Injected fallback text because all assistant replay parts were removed.",
    })
    stats.invariantsRepaired += 1
    return {
      id: message.id,
      role: message.role,
      parts: [{ type: "text", text: "" }] as MessagePart[],
    } as UIMessage
  }

  return {
    id: message.id,
    role: message.role,
    parts: assistantCompiled,
  } as UIMessage
}

export const openaiReplayCompiler: ReplayCompiler = {
  providerId: "openai",
  compileReplay(
    messages: readonly ReplayMessage[],
    _context: ReplayCompileContext
  ): ReplayCompileResult {
    const warnings: ReplayCompileWarning[] = []
    const stats: ReplayCompileStats = {
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

    const compiledMessages = messages.map((message, messageIndex) =>
      compileMessage(message, messageIndex, warnings, stats)
    )

    stats.compiledMessageCount = compiledMessages.length
    stats.droppedMessages = Math.max(
      0,
      stats.originalMessageCount - stats.compiledMessageCount
    )
    stats.totalPartsCompiled = compiledMessages.reduce(
      (sum, message) => sum + message.parts.length,
      0
    )

    return {
      messages: compiledMessages,
      warnings,
      stats,
    }
  },
}
