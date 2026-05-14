import type { UIMessage } from "ai"
import type { ReplayMessage, ReplayPart, ReplayToolExchange } from "../types"
import { synthesizePlatformToolFallback } from "./platform-tool-fallback"
import type {
  ReplayCompileContext,
  ReplayCompileResult,
  ReplayCompileStats,
  ReplayCompiler,
  ReplayCompileWarning,
} from "./index"

type MessagePart = UIMessage["parts"][number]
type ToolPart = MessagePart & {
  type: string
  state?: string
  toolCallId?: string
  output?: unknown
}

const OPENAI_FINAL_TOOL_STATES = new Set(["output-available", "output-error", "output-denied"])

function isReasoningPart(part: MessagePart): boolean {
  return part.type === "reasoning"
}

function isToolPart(part: MessagePart): part is ToolPart {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-")
}

function hasToolOutput(part: MessagePart): boolean {
  return isToolPart(part) && "output" in (part as Record<string, unknown>)
}

function hasFinalToolState(part: MessagePart): boolean {
  if (!isToolPart(part)) return true
  if (typeof part.state !== "string") return true
  return OPENAI_FINAL_TOOL_STATES.has(part.state)
}

function splitByStepStart(parts: MessagePart[]): MessagePart[][] {
  const blocks: MessagePart[][] = []
  let current: MessagePart[] = []

  for (const part of parts) {
    if (part.type === "step-start") {
      if (current.length > 0) blocks.push(current)
      current = []
      continue
    }
    current.push(part)
  }

  if (current.length > 0) blocks.push(current)
  return blocks
}

function buildToolReplayPart(
  tool: ReplayToolExchange,
  messageIndex: number,
  partIndex: number,
): MessagePart | null {
  if (!tool.replayable || tool.toolName !== "web_search" || !tool.webSearch) return null

  const toolCallId = tool.toolCallId?.trim() || `replay_ws_${messageIndex}_${partIndex}`
  const query = tool.webSearch.query
  const sources = tool.webSearch.results.map((result) => ({
    url: result.url,
    title: result.title,
    snippet: result.snippet,
  }))

  return {
    type: "tool-web_search",
    state: "output-available",
    toolCallId,
    toolName: "web_search",
    providerExecuted: true,
    input: { query },
    output: {
      action: "search",
      sources,
    },
  } as MessagePart
}

function compileAssistantParts(
  parts: ReplayPart[],
  messageIndex: number,
  warnings: ReplayCompileWarning[],
  stats: ReplayCompileStats,
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
      warnings.push({
        code: "source_url_dropped",
        messageIndex,
        partIndex,
        detail: "Dropped source-url part for OpenAI replay invariants.",
      })
      return
    }

    stats.toolExchangesSeen += 1
    const replayToolPart = buildToolReplayPart(part.tool, messageIndex, partIndex)

    if (!replayToolPart) {
      stats.toolExchangesDropped += 1

      const platformFallback = synthesizePlatformToolFallback(part.tool)
      if (platformFallback) {
        compiled.push({ type: "text", text: platformFallback } as MessagePart)
      }

      warnings.push({
        code: "tool_non_replayable",
        messageIndex,
        partIndex,
        detail: part.tool.nonReplayableReason ?? `Tool "${part.tool.toolName}" is not replayable for OpenAI.`,
      })
      return
    }

    compiled.push({ type: "step-start" } as MessagePart)
    compiled.push({
      type: "reasoning",
      state: "done",
      text: "",
      reasoning: `Replay tool result for "${part.tool.toolName}" continuity.`,
    } as unknown as MessagePart)
    compiled.push(replayToolPart)
    stats.toolExchangesCompiled += 1
  })

  return compiled
}

function enforceAssistantInvariants(
  parts: MessagePart[],
  messageIndex: number,
  warnings: ReplayCompileWarning[],
  stats: ReplayCompileStats,
): MessagePart[] {
  const blocks = splitByStepStart(parts)
  if (blocks.length === 0) return parts

  const compiled: MessagePart[] = []

  blocks.forEach((block) => {
    const hasTool = block.some((part) => isToolPart(part))
    if (!hasTool) {
      compiled.push(...block)
      return
    }

    const firstToolIndex = block.findIndex((part) => isToolPart(part))
    const hasReasoningBeforeTool = block.slice(0, firstToolIndex).some((part) => isReasoningPart(part))
    const hasReasoningAfterTool = block.slice(firstToolIndex + 1).some((part) => isReasoningPart(part))
    const hasInvalidToolParts = block.some((part) => isToolPart(part) && (!hasToolOutput(part) || !hasFinalToolState(part)))

    if (hasReasoningAfterTool || hasInvalidToolParts) {
      warnings.push({
        code: "invariant_block_dropped",
        messageIndex,
        detail:
          "Dropped replay tool block violating OpenAI invariants (reasoning-after-tool or missing final output).",
      })
      stats.invariantsRepaired += 1
      return
    }

    if (!hasReasoningBeforeTool) {
      compiled.push({
        type: "reasoning",
        state: "done",
        text: "",
        reasoning: "Replay reasoning context injected to preserve OpenAI tool/result invariants.",
      } as unknown as MessagePart)
      warnings.push({
        code: "invariant_reasoning_injected",
        messageIndex,
        detail: "Injected missing reasoning part before replayed tool block.",
      })
      stats.invariantsRepaired += 1
    }

    compiled.push(...block)
  })

  return compiled
}

function compileMessage(
  message: ReplayMessage,
  messageIndex: number,
  warnings: ReplayCompileWarning[],
  stats: ReplayCompileStats,
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
        warnings.push({
          code: "source_url_dropped",
          messageIndex,
          partIndex,
          detail: "Dropped source-url part in non-assistant message for OpenAI replay.",
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
      parts: nonAssistantParts.length > 0 ? nonAssistantParts : ([{ type: "text", text: "" }] as MessagePart[]),
    } as UIMessage
  }

  const assistantCompiled = compileAssistantParts(message.parts, messageIndex, warnings, stats)
  const invariantSafe = enforceAssistantInvariants(assistantCompiled, messageIndex, warnings, stats)

  if (invariantSafe.length === 0) {
    warnings.push({
      code: "message_empty_fallback",
      messageIndex,
      detail: "Injected fallback text because all assistant replay parts were removed.",
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
    parts: invariantSafe,
  } as UIMessage
}

export const openaiReplayCompiler: ReplayCompiler = {
  providerId: "openai",
  compileReplay(messages: readonly ReplayMessage[], _context: ReplayCompileContext): ReplayCompileResult {
    const warnings: ReplayCompileWarning[] = []
    const stats: ReplayCompileStats = {
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

    const compiledMessages = messages.map((message, messageIndex) =>
      compileMessage(message, messageIndex, warnings, stats),
    )

    stats.compiledMessageCount = compiledMessages.length
    stats.droppedMessages = Math.max(0, stats.originalMessageCount - stats.compiledMessageCount)
    stats.totalPartsCompiled = compiledMessages.reduce((sum, message) => sum + message.parts.length, 0)

    return {
      messages: compiledMessages,
      warnings,
      stats,
    }
  },
}
