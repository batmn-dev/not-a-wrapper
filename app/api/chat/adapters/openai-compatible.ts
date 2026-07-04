import type { UIMessage } from "ai"
import type {
  AdaptationContext,
  AdaptationResult,
  AdaptationWarning,
  ProviderHistoryAdapter,
} from "./types"
import {
  createEmptyStats,
  incrementStat,
  isToolPart,
  isToolPartFinal,
  stripCallProviderMetadata,
} from "./types"

type MessagePart = UIMessage["parts"][number]
type MutablePart = MessagePart & Record<string, unknown>

function getPartType(part: MessagePart): string {
  return (part as { type?: string }).type ?? "unknown"
}

function getToolCallId(part: MessagePart): string | null {
  const toolCallId = (part as { toolCallId?: unknown }).toolCallId
  return typeof toolCallId === "string" && toolCallId.length > 0
    ? toolCallId
    : null
}

function getToolName(part: MessagePart): string | null {
  const toolName = (part as { toolName?: unknown }).toolName
  if (typeof toolName === "string" && toolName.length > 0) return toolName

  const name = (part as { name?: unknown }).name
  return typeof name === "string" && name.length > 0 ? name : null
}

function isToolInvocationPart(part: MessagePart): boolean {
  const type = getPartType(part)
  return (
    type === "dynamic-tool" ||
    (type.startsWith("tool-") && type !== "tool-result")
  )
}

function isToolResultPart(part: MessagePart): boolean {
  if (getPartType(part) === "tool-result") return true
  if (!isToolInvocationPart(part)) return false
  return "output" in (part as Record<string, unknown>)
}

function isDropByType(type: string): boolean {
  return (
    type === "reasoning" ||
    type === "step-start" ||
    type === "source-url" ||
    type === "source-document"
  )
}

export const openaiCompatibleAdapter: ProviderHistoryAdapter = {
  providerId: "openai-compatible",
  metadata: {
    droppedPartTypes: new Set([
      "reasoning",
      "step-start",
      "source-url",
      "source-document",
    ]),
    transformedPartTypes: new Set(["tool-*"]),
    tier: "standard",
    description: "OpenAI-compatible format — shared for xAI + Mistral",
  },

  async adaptMessages(
    messages: readonly UIMessage[],
    _context: AdaptationContext
  ): Promise<AdaptationResult> {
    const totalPartsOriginal = messages.reduce(
      (sum, message) => sum + message.parts.length,
      0
    )
    const stats = createEmptyStats(messages.length, totalPartsOriginal)
    const warnings: AdaptationWarning[] = []
    const adaptedMessages: UIMessage[] = []

    for (const [messageIndex, message] of messages.entries()) {
      const invocationIds = new Set<string>()
      const resultIds = new Set<string>()
      const toolNameById = new Map<string, string>()
      const pendingParts: Array<{ part: MessagePart; transformed: boolean }> =
        []

      for (const part of message.parts) {
        const type = getPartType(part)

        if (isDropByType(type)) {
          incrementStat(stats.partsDropped, type)
          continue
        }

        if (
          isToolPart(part) &&
          "state" in (part as Record<string, unknown>) &&
          !isToolPartFinal(part as { state?: string })
        ) {
          incrementStat(stats.partsDropped, type)
          warnings.push({
            code: "non_final_state_dropped",
            messageIndex,
            detail: `Dropped non-final tool part (${type}).`,
          })
          continue
        }

        let nextPart = part
        let transformed = false

        if ("callProviderMetadata" in (part as Record<string, unknown>)) {
          nextPart = stripCallProviderMetadata(part)
          transformed = nextPart !== part
          if (transformed) {
            stats.providerIdsStripped += 1
          }
        }

        const toolCallId = getToolCallId(nextPart)
        if (!toolCallId) {
          pendingParts.push({ part: nextPart, transformed })
          continue
        }

        if (isToolInvocationPart(nextPart)) {
          invocationIds.add(toolCallId)
          const toolName = getToolName(nextPart)
          if (toolName) toolNameById.set(toolCallId, toolName)
        }

        if (isToolResultPart(nextPart)) {
          resultIds.add(toolCallId)
        }

        pendingParts.push({ part: nextPart, transformed })
      }

      const validToolIds = new Set<string>()
      for (const toolCallId of invocationIds) {
        if (resultIds.has(toolCallId)) validToolIds.add(toolCallId)
      }

      const sanitizedParts: MessagePart[] = []
      for (const { part, transformed } of pendingParts) {
        const type = getPartType(part)
        const toolCallId = getToolCallId(part)

        if (
          toolCallId &&
          (isToolInvocationPart(part) || isToolResultPart(part))
        ) {
          if (!validToolIds.has(toolCallId)) {
            incrementStat(stats.partsDropped, type)
            warnings.push({
              code: "incomplete_triple_dropped",
              messageIndex,
              detail: `Dropped orphan tool part (${type}) for toolCallId=${toolCallId}.`,
            })
            continue
          }

          if (isToolResultPart(part)) {
            const hasName =
              typeof (part as { name?: unknown }).name === "string"
            if (!hasName) {
              const derivedName = toolNameById.get(toolCallId)
              if (!derivedName) {
                incrementStat(stats.partsDropped, type)
                warnings.push({
                  code: "incomplete_triple_dropped",
                  messageIndex,
                  detail: `Dropped tool pair for toolCallId=${toolCallId}; missing result name and no invocation toolName.`,
                })
                validToolIds.delete(toolCallId)
                continue
              }
              const mutablePart = {
                ...(part as MutablePart),
                name: derivedName,
              } as unknown as MessagePart
              sanitizedParts.push(mutablePart)
              incrementStat(stats.partsTransformed, type)
              continue
            }
          }
        }

        sanitizedParts.push(part)
        if (transformed) {
          incrementStat(stats.partsTransformed, type)
        } else {
          incrementStat(stats.partsPreserved, type)
        }
      }

      const finalParts = sanitizedParts.filter((part) => {
        const toolCallId = getToolCallId(part)
        if (!toolCallId) return true
        if (isToolInvocationPart(part) || isToolResultPart(part)) {
          return validToolIds.has(toolCallId)
        }
        return true
      })

      if (finalParts.length === 0) {
        if ((message as { role: string }).role === "tool") {
          stats.droppedMessages += 1
          continue
        }

        warnings.push({
          code: "empty_message_fallback",
          messageIndex,
          detail: "Injected fallback text because all parts were stripped.",
        })

        incrementStat(stats.partsTransformed, "text")
        adaptedMessages.push({
          ...message,
          parts: [{ type: "text", text: "" }],
        })
        continue
      }

      adaptedMessages.push({
        ...message,
        parts: finalParts,
      })
    }

    stats.adaptedMessageCount = adaptedMessages.length
    stats.totalPartsAdapted = adaptedMessages.reduce(
      (sum, message) => sum + message.parts.length,
      0
    )
    stats.droppedMessages +=
      messages.length - adaptedMessages.length - stats.droppedMessages

    return {
      messages: adaptedMessages,
      stats,
      warnings,
    }
  },
}
