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
  stripCallProviderMetadata,
} from "./types"

type MessagePart = UIMessage["parts"][number]

function getPartType(part: MessagePart): string {
  return (part as { type?: string }).type ?? "unknown"
}

export const textOnlyAdapter: ProviderHistoryAdapter = {
  providerId: "text-only",
  metadata: {
    droppedPartTypes: new Set([
      "reasoning",
      "step-start",
      "tool-*",
      "dynamic-tool",
      "source-url",
      "source-document",
      "file",
    ]),
    transformedPartTypes: new Set([]),
    tier: "simple",
    description: "Text-only providers — strip everything except text",
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
      if ((message as { role: string }).role === "tool") {
        stats.droppedMessages += 1
        continue
      }

      const textParts: MessagePart[] = []
      for (const part of message.parts) {
        const type = getPartType(part)

        if (type !== "text") {
          incrementStat(stats.partsDropped, type)
          continue
        }

        const stripped = stripCallProviderMetadata(part)
        if (stripped !== part) {
          stats.providerIdsStripped += 1
          incrementStat(stats.partsTransformed, type)
        } else {
          incrementStat(stats.partsPreserved, type)
        }

        textParts.push(stripped)
      }

      if (textParts.length === 0) {
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
        parts: textParts,
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
