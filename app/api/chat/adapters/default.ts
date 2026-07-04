import type { UIMessage } from "ai"
import {
  createEmptyStats,
  incrementStat,
  isToolPart,
  isToolPartFinal,
  stripCallProviderMetadata,
  type AdaptationResult,
  type AdaptationWarning,
  type ProviderHistoryAdapter,
} from "./types"

function shouldDropPart(partType: string): boolean {
  if (partType === "reasoning") return true
  if (partType === "step-start") return true
  if (partType === "source-url") return true
  if (partType === "source-document") return true
  if (partType === "dynamic-tool") return true
  if (isToolPart({ type: partType })) return true
  return false
}

function shouldKeepPart(partType: string): boolean {
  if (partType === "text") return true
  if (partType === "file") return true
  if (partType.startsWith("data-")) return true
  return false
}

export const defaultAdapter: ProviderHistoryAdapter = {
  providerId: "default",
  metadata: {
    droppedPartTypes: new Set([
      "reasoning",
      "step-start",
      "source-url",
      "source-document",
      "tool-*",
      "dynamic-tool",
    ]),
    transformedPartTypes: new Set(),
    tier: "simple",
    description:
      "Conservative fallback - strip all non-text content (current behavior)",
  },
  async adaptMessages(messages): Promise<AdaptationResult> {
    const totalPartsOriginal = messages.reduce(
      (sum, message) => sum + message.parts.length,
      0
    )
    const stats = createEmptyStats(messages.length, totalPartsOriginal)
    const warnings: AdaptationWarning[] = []
    const adapted: UIMessage[] = []

    for (const [messageIndex, message] of messages.entries()) {
      const role = (message as { role?: string }).role
      if (role === "tool") {
        stats.droppedMessages += 1
        warnings.push({
          code: "incomplete_triple_dropped",
          messageIndex,
          detail: 'Dropped `role: "tool"` message in default adapter',
        })
        continue
      }

      const nextParts: Array<Record<string, unknown>> = []

      for (const part of message.parts) {
        const mutablePart = part as Record<string, unknown>
        const partType =
          typeof mutablePart.type === "string" ? mutablePart.type : "unknown"

        if (isToolPart({ type: partType }) && !isToolPartFinal(mutablePart)) {
          incrementStat(stats.partsDropped, partType)
          warnings.push({
            code: "non_final_state_dropped",
            messageIndex,
            detail: `Dropped non-final tool state "${String(mutablePart.state ?? "unknown")}"`,
          })
          continue
        }

        if (shouldDropPart(partType) || !shouldKeepPart(partType)) {
          incrementStat(stats.partsDropped, partType)
          continue
        }

        let nextPart = mutablePart
        if ("callProviderMetadata" in nextPart) {
          nextPart = stripCallProviderMetadata(nextPart)
          stats.providerIdsStripped += 1
          incrementStat(stats.partsTransformed, partType)
          warnings.push({
            code: "provider_ids_stripped",
            messageIndex,
            detail: "Stripped callProviderMetadata in default adapter",
          })
        }

        nextParts.push(nextPart)
        incrementStat(stats.partsPreserved, partType)
      }

      if (role === "assistant" && nextParts.length === 0) {
        nextParts.push({ type: "text", text: "" })
        incrementStat(stats.partsTransformed, "fallback-text")
        warnings.push({
          code: "empty_message_fallback",
          messageIndex,
          detail:
            "Injected empty text fallback because assistant parts were stripped",
        })
      }

      adapted.push({
        ...message,
        parts: nextParts as UIMessage["parts"],
      })
    }

    stats.adaptedMessageCount = adapted.length
    stats.totalPartsAdapted = adapted.reduce(
      (sum, message) => sum + message.parts.length,
      0
    )

    return {
      messages: adapted,
      stats,
      warnings,
    }
  },
}
