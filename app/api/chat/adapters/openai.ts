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
type PartWithToolFields = MessagePart & {
  type: string
  state?: string
  toolCallId?: string
  callProviderMetadata?: Record<string, unknown>
}

type BlockValidationResult =
  | { keep: true; parts: MessagePart[] }
  | { keep: false; reason: string; droppedParts: MessagePart[] }

function isReasoningPart(part: MessagePart): boolean {
  return part.type === "reasoning"
}

function isTextPart(part: MessagePart): boolean {
  return part.type === "text"
}

function isDroppedArtifactType(part: MessagePart): boolean {
  return (
    part.type === "step-start" ||
    part.type === "source-url" ||
    part.type === "source-document"
  )
}

function hasStepStarts(parts: MessagePart[]): boolean {
  return parts.some((part) => part.type === "step-start")
}

function splitByStepStart(parts: MessagePart[]): MessagePart[][] {
  const blocks: MessagePart[][] = []
  let current: MessagePart[] = []

  for (const part of parts) {
    if (part.type === "step-start") {
      if (current.length > 0) {
        blocks.push(current)
      }
      current = []
      continue
    }
    current.push(part)
  }

  if (current.length > 0) {
    blocks.push(current)
  }

  return blocks
}

function splitBySemanticFallback(parts: MessagePart[]): MessagePart[][] {
  const blocks: MessagePart[][] = []
  let current: MessagePart[] = []
  let currentHasTool = false

  for (const part of parts) {
    // If no step markers exist, a new reasoning block after tool activity
    // indicates a new semantic step boundary.
    if (isReasoningPart(part) && current.length > 0 && currentHasTool) {
      blocks.push(current)
      current = []
      currentHasTool = false
    }

    current.push(part)
    if (isToolPart(part)) {
      currentHasTool = true
    }
  }

  if (current.length > 0) {
    blocks.push(current)
  }

  return blocks
}

function validateOpenAIBlock(block: MessagePart[]): BlockValidationResult {
  const sanitized = block.filter((part) => !isDroppedArtifactType(part))
  if (sanitized.length === 0) {
    return {
      keep: false,
      reason: "block had only dropped artifacts",
      droppedParts: block,
    }
  }

  const hasTool = sanitized.some((part) => isToolPart(part))
  const reasoningIndexes = sanitized
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => isReasoningPart(part))
    .map(({ index }) => index)

  if (!hasTool) {
    if (reasoningIndexes.length === 0) {
      return { keep: true, parts: sanitized }
    }

    const hasReasoningTextPair = reasoningIndexes.some((reasoningIndex) =>
      sanitized.slice(reasoningIndex + 1).some((part) => isTextPart(part))
    )

    if (!hasReasoningTextPair) {
      return {
        keep: false,
        reason: "reasoning had no text pair",
        droppedParts: sanitized,
      }
    }

    return { keep: true, parts: sanitized }
  }

  const firstToolIndex = sanitized.findIndex((part) => isToolPart(part))
  const hasReasoningBeforeFirstTool = sanitized
    .slice(0, firstToolIndex)
    .some((part) => isReasoningPart(part))

  if (!hasReasoningBeforeFirstTool) {
    return {
      keep: false,
      reason: "tool parts were missing required preceding reasoning",
      droppedParts: sanitized,
    }
  }

  const hasReasoningAfterFirstTool = sanitized
    .slice(firstToolIndex + 1)
    .some((part) => isReasoningPart(part))

  if (hasReasoningAfterFirstTool) {
    return {
      keep: false,
      reason:
        "tool block had mid-block reasoning and is structurally ambiguous",
      droppedParts: sanitized,
    }
  }

  return { keep: true, parts: sanitized }
}

// OpenAI replay must be SELF-CONTAINED. With the Responses API default
// `store: true`, any history part carrying `providerMetadata.openai.itemId`
// (msg_/rs_ ids on text and reasoning parts) is serialized as a server-side
// `item_reference` lookup instead of its actual content — and the API 400s
// (`invalid_value` on `input`) whenever the referenced items are not
// retrievable under the current key. Strip BOTH metadata carriers from every
// history part so replay always sends real content and never provider-linked
// ids. The live continuation tail never passes through this adapter, so
// approval-protocol metadata is unaffected.
function stripProviderMetadataFromPart(part: MessagePart): {
  part: MessagePart
  hadProviderMetadata: boolean
} {
  const record = part as PartWithToolFields & {
    providerMetadata?: Record<string, unknown>
  }
  const hadCallProviderMetadata = record.callProviderMetadata != null
  const hadProviderMetadata = record.providerMetadata != null
  if (!hadCallProviderMetadata && !hadProviderMetadata) {
    return { part, hadProviderMetadata: false }
  }

  const stripped = stripCallProviderMetadata(record) as MessagePart & {
    providerMetadata?: Record<string, unknown>
  }
  if (hadProviderMetadata) {
    const { providerMetadata: _providerMetadata, ...rest } = stripped
    return { part: rest as MessagePart, hadProviderMetadata: true }
  }

  return {
    part: stripped,
    hadProviderMetadata: true,
  }
}

export const openaiAdapter: ProviderHistoryAdapter = {
  providerId: "openai",
  metadata: {
    droppedPartTypes: new Set(["step-start", "source-url", "source-document"]),
    transformedPartTypes: new Set(["tool-*", "reasoning"]),
    tier: "complex",
    description:
      "OpenAI Responses API — atomic reasoning→tool→result triple enforcement",
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
      const role = message.role
      const originalParts = [...message.parts]
      const keptParts: MessagePart[] = []

      if (role !== "assistant") {
        const prefilteredParts = originalParts.filter((part) => {
          if (!isToolPart(part)) return true
          if (isToolPartFinal(part as { state?: string })) return true

          incrementStat(stats.partsDropped, part.type)
          warnings.push({
            code: "non_final_state_dropped",
            messageIndex,
            detail: `Dropped non-final tool part (${part.type})`,
          })
          return false
        })

        for (const part of prefilteredParts) {
          if (isDroppedArtifactType(part)) {
            incrementStat(stats.partsDropped, part.type)
            continue
          }

          const stripped = stripProviderMetadataFromPart(part)
          if (stripped.hadProviderMetadata) {
            stats.providerIdsStripped += 1
            incrementStat(stats.partsTransformed, part.type)
            warnings.push({
              code: "provider_ids_stripped",
              messageIndex,
              detail: `Stripped callProviderMetadata from ${part.type}`,
            })
          } else {
            incrementStat(stats.partsPreserved, part.type)
          }
          keptParts.push(stripped.part)
        }

        adaptedMessages.push({
          ...message,
          parts: keptParts,
        })
        continue
      }

      for (const part of originalParts) {
        if (part.type === "step-start") {
          incrementStat(stats.partsDropped, part.type)
        }
      }

      const blocks = hasStepStarts(originalParts)
        ? splitByStepStart(originalParts)
        : splitBySemanticFallback(originalParts)

      for (const block of blocks) {
        let blockHadNonFinalTool = false
        const prefilteredBlock = block.filter((part) => {
          if (!isToolPart(part)) return true
          if (isToolPartFinal(part as { state?: string })) return true

          blockHadNonFinalTool = true
          incrementStat(stats.partsDropped, part.type)
          warnings.push({
            code: "non_final_state_dropped",
            messageIndex,
            detail: `Dropped non-final tool part (${part.type})`,
          })
          return false
        })

        if (blockHadNonFinalTool) {
          for (const droppedPart of prefilteredBlock) {
            incrementStat(stats.partsDropped, droppedPart.type)
          }
          warnings.push({
            code: "incomplete_triple_dropped",
            messageIndex,
            detail:
              "Dropped block containing non-final tool state to preserve atomic triple",
          })
          continue
        }

        const validation = validateOpenAIBlock(prefilteredBlock)
        if (!validation.keep) {
          for (const droppedPart of validation.droppedParts) {
            incrementStat(stats.partsDropped, droppedPart.type)
          }
          warnings.push({
            code: "incomplete_triple_dropped",
            messageIndex,
            detail: validation.reason,
          })
          continue
        }

        for (const part of validation.parts) {
          if (isDroppedArtifactType(part)) {
            incrementStat(stats.partsDropped, part.type)
            continue
          }

          const stripped = stripProviderMetadataFromPart(part)
          if (stripped.hadProviderMetadata) {
            stats.providerIdsStripped += 1
            incrementStat(stats.partsTransformed, part.type)
            warnings.push({
              code: "provider_ids_stripped",
              messageIndex,
              detail: `Stripped callProviderMetadata from ${part.type}`,
            })
          } else {
            incrementStat(stats.partsPreserved, part.type)
          }
          keptParts.push(stripped.part)
        }
      }

      if (keptParts.length === 0) {
        keptParts.push({ type: "text", text: "" } as MessagePart)
        incrementStat(stats.partsTransformed, "text")
        warnings.push({
          code: "empty_message_fallback",
          messageIndex,
          detail:
            "All assistant parts were stripped; injected fallback empty text",
        })
      }

      adaptedMessages.push({
        ...message,
        parts: keptParts,
      })
    }

    stats.adaptedMessageCount = adaptedMessages.length
    stats.droppedMessages = Math.max(
      0,
      stats.originalMessageCount - stats.adaptedMessageCount
    )
    stats.totalPartsAdapted = adaptedMessages.reduce(
      (sum, message) => sum + message.parts.length,
      0
    )

    return {
      messages: adaptedMessages,
      stats,
      warnings,
    }
  },
}
