import type { UIMessage } from "ai"
import {
  defineHistoryAdapter,
  detectSourceProvider,
  dropNonFinalToolPart,
  incrementStat,
  isToolPart,
  stripCallProviderMetadata,
  type AdaptationResult,
  type AdaptationWarning,
} from "./types"

type MessagePart = Record<string, unknown> & {
  type: string
  state?: string
  toolCallId?: string
  callProviderMetadata?: Record<string, unknown>
  providerMetadata?: Record<string, unknown>
}

function toPart(part: unknown): MessagePart {
  return part as MessagePart
}

function getTextValue(part: MessagePart): string {
  const candidate = (part as { text?: unknown }).text
  return typeof candidate === "string" ? candidate : ""
}

function hasToolInvocation(part: MessagePart): boolean {
  if (!isToolPart(part)) return false
  if (part.type === "tool-result") return false
  if ("input" in part) return true
  const state = typeof part.state === "string" ? part.state : ""
  return state.startsWith("input-") || state.startsWith("output-")
}

function hasToolResult(part: MessagePart): boolean {
  if (!isToolPart(part)) return false
  if (part.type === "tool-result") return true
  if ("output" in part) return true
  const state = typeof part.state === "string" ? part.state : ""
  return state.startsWith("output-")
}

function addFallbackAssistantText(
  message: UIMessage,
  warnings: AdaptationWarning[],
  messageIndex: number
): UIMessage {
  if (message.role !== "assistant") return message
  if (message.parts.length > 0) return message

  warnings.push({
    code: "empty_message_fallback",
    messageIndex,
    detail:
      "Assistant message became empty after adaptation; injected empty text part.",
  })

  return {
    ...message,
    parts: [{ type: "text", text: "" }],
  } as UIMessage
}

function mergeUserTextParts(prev: UIMessage, current: UIMessage): UIMessage {
  const mergedParts: MessagePart[] = []
  const appendPart = (rawPart: unknown): void => {
    const part = toPart(rawPart)
    if (part.type !== "text") {
      mergedParts.push(part)
      return
    }

    const textValue = getTextValue(part)

    const previousPart = mergedParts[mergedParts.length - 1]
    if (previousPart?.type !== "text") {
      mergedParts.push({ ...part, text: textValue })
      return
    }

    const previousText = getTextValue(previousPart)
    const combinedText =
      previousText.length > 0 && textValue.length > 0
        ? `${previousText}\n\n${textValue}`
        : `${previousText}${textValue}`
    mergedParts[mergedParts.length - 1] = {
      ...previousPart,
      text: combinedText,
    }
  }

  for (const part of prev.parts) appendPart(part)
  for (const part of current.parts) appendPart(part)

  return {
    ...prev,
    parts: mergedParts,
  } as UIMessage
}

function dropWithStat(
  statsRecord: Record<string, number>,
  partType: string
): void {
  incrementStat(statsRecord, partType)
}

function isDroppedArtifactType(partType: string): boolean {
  return (
    partType === "step-start" ||
    partType === "source-url" ||
    partType === "source-document"
  )
}

function pairFilterParts(
  parts: MessagePart[],
  messageIndex: number,
  warnings: AdaptationWarning[],
  stats: AdaptationResult["stats"]
): MessagePart[] {
  const invocationCount = new Map<string, number>()
  const resultCount = new Map<string, number>()

  for (const part of parts) {
    if (!isToolPart(part)) continue
    const toolCallId =
      typeof part.toolCallId === "string" ? part.toolCallId : null
    if (!toolCallId) continue
    if (hasToolInvocation(part)) {
      invocationCount.set(
        toolCallId,
        (invocationCount.get(toolCallId) ?? 0) + 1
      )
    }
    if (hasToolResult(part)) {
      resultCount.set(toolCallId, (resultCount.get(toolCallId) ?? 0) + 1)
    }
  }

  const nextParts: MessagePart[] = []
  for (const part of parts) {
    if (!isToolPart(part)) {
      nextParts.push(part)
      continue
    }

    const toolCallId =
      typeof part.toolCallId === "string" ? part.toolCallId : null
    if (!toolCallId) {
      warnings.push({
        code: "incomplete_triple_dropped",
        messageIndex,
        detail: "Dropped tool part without toolCallId.",
      })
      dropWithStat(stats.partsDropped, part.type)
      continue
    }

    const hasPair =
      (invocationCount.get(toolCallId) ?? 0) > 0 &&
      (resultCount.get(toolCallId) ?? 0) > 0

    if (!hasPair) {
      warnings.push({
        code: "incomplete_triple_dropped",
        messageIndex,
        detail: `Dropped orphaned tool part for toolCallId=${toolCallId}.`,
      })
      dropWithStat(stats.partsDropped, part.type)
      continue
    }

    nextParts.push(part)
  }

  return nextParts
}

function enforceFcFrParity(
  parts: MessagePart[],
  messageIndex: number,
  warnings: AdaptationWarning[],
  stats: AdaptationResult["stats"]
): MessagePart[] {
  const invocationCount = new Map<string, number>()
  const resultCount = new Map<string, number>()

  for (const part of parts) {
    if (!isToolPart(part)) continue
    const toolCallId =
      typeof part.toolCallId === "string" ? part.toolCallId : null
    if (!toolCallId) continue
    if (hasToolInvocation(part)) {
      invocationCount.set(
        toolCallId,
        (invocationCount.get(toolCallId) ?? 0) + 1
      )
    }
    if (hasToolResult(part)) {
      resultCount.set(toolCallId, (resultCount.get(toolCallId) ?? 0) + 1)
    }
  }

  const allowedPairs = new Map<string, number>()
  const allToolCallIds = new Set<string>([
    ...invocationCount.keys(),
    ...resultCount.keys(),
  ])
  for (const toolCallId of allToolCallIds) {
    const allowed = Math.min(
      invocationCount.get(toolCallId) ?? 0,
      resultCount.get(toolCallId) ?? 0
    )
    allowedPairs.set(toolCallId, allowed)
  }

  const usedInvocation = new Map<string, number>()
  const usedResult = new Map<string, number>()
  const nextParts: MessagePart[] = []

  for (const part of parts) {
    if (!isToolPart(part)) {
      nextParts.push(part)
      continue
    }

    const toolCallId =
      typeof part.toolCallId === "string" ? part.toolCallId : null
    if (!toolCallId) {
      warnings.push({
        code: "incomplete_triple_dropped",
        messageIndex,
        detail:
          "Dropped tool part without toolCallId during FC/FR parity check.",
      })
      dropWithStat(stats.partsDropped, part.type)
      continue
    }

    const allowed = allowedPairs.get(toolCallId) ?? 0
    const isInvocation = hasToolInvocation(part)
    const isResult = hasToolResult(part)
    const usedInv = usedInvocation.get(toolCallId) ?? 0
    const usedRes = usedResult.get(toolCallId) ?? 0

    const canKeepInvocation = !isInvocation || usedInv < allowed
    const canKeepResult = !isResult || usedRes < allowed

    if (!canKeepInvocation || !canKeepResult) {
      warnings.push({
        code: "incomplete_triple_dropped",
        messageIndex,
        detail: `Dropped unpaired tool part for toolCallId=${toolCallId} to enforce FC/FR parity.`,
      })
      dropWithStat(stats.partsDropped, part.type)
      continue
    }

    if (isInvocation) {
      usedInvocation.set(toolCallId, usedInv + 1)
    }
    if (isResult) {
      usedResult.set(toolCallId, usedRes + 1)
    }
    nextParts.push(part)
  }

  return nextParts
}

function injectGemini3ThoughtSignatures(
  messages: UIMessage[],
  warnings: AdaptationWarning[],
  stats: AdaptationResult["stats"],
  messageIndex: number
): UIMessage[] {
  let lastAssistantIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") {
      lastAssistantIndex = index
      break
    }
  }
  if (lastAssistantIndex === -1) return messages

  const target = messages[lastAssistantIndex]
  const nextParts = target.parts.map((rawPart) => {
    const part = toPart(rawPart)
    if (!isToolPart(part) || !hasToolInvocation(part)) {
      return rawPart
    }

    const providerMetadata = (part.providerMetadata ?? {}) as Record<
      string,
      unknown
    >
    const googleMetadata = (providerMetadata.google ?? {}) as Record<
      string,
      unknown
    >
    if (
      typeof googleMetadata.thoughtSignature === "string" &&
      googleMetadata.thoughtSignature.length > 0
    ) {
      return rawPart
    }

    warnings.push({
      code: "thought_signature_injected",
      messageIndex,
      detail:
        "Injected Gemini 3 thought signature placeholder for tool invocation replay.",
    })
    incrementStat(stats.partsTransformed, part.type)

    return {
      ...part,
      providerMetadata: {
        ...providerMetadata,
        google: {
          ...googleMetadata,
          thoughtSignature: "skip_thought_signature_validator",
        },
      },
    }
  })

  const nextMessages = messages.slice()
  nextMessages[lastAssistantIndex] = {
    ...target,
    parts: nextParts,
  } as UIMessage

  return nextMessages
}

export const googleAdapter = defineHistoryAdapter({
  providerId: "google",

  metadata: {
    droppedPartTypes: new Set(["step-start", "source-url", "source-document"]),
    transformedPartTypes: new Set(["tool-*", "reasoning"]),
    tier: "structural",
    description:
      "Google Gemini - strict FC/FR parity, role alternation, thought signatures",
  },

  async adaptMessages(messages, context, session) {
    const { stats, warnings } = session

    const pass1Messages: UIMessage[] = messages.map((message, messageIndex) => {
      const nextPartsRaw: MessagePart[] = []

      for (const rawPart of message.parts) {
        const part = toPart(rawPart)

        if (isDroppedArtifactType(part.type)) {
          dropWithStat(stats.partsDropped, part.type)
          continue
        }

        if (dropNonFinalToolPart(part, messageIndex, session)) {
          continue
        }

        let nextPart = part
        if (isToolPart(part)) {
          const sourceProvider = detectSourceProvider(
            part as { callProviderMetadata?: Record<string, unknown> }
          )
          if (sourceProvider && sourceProvider !== "google") {
            nextPart = stripCallProviderMetadata(nextPart)
            stats.providerIdsStripped += 1
            incrementStat(stats.partsTransformed, part.type)
            warnings.push({
              code: "provider_ids_stripped",
              messageIndex,
              detail: `Stripped provider metadata from ${sourceProvider} tool part.`,
            })
          }
        }

        nextPartsRaw.push(nextPart)
      }

      const pairedParts = pairFilterParts(
        nextPartsRaw,
        messageIndex,
        warnings,
        stats
      )
      const paritySafeParts =
        message.role === "assistant"
          ? enforceFcFrParity(pairedParts, messageIndex, warnings, stats)
          : pairedParts

      for (const part of paritySafeParts) {
        incrementStat(stats.partsPreserved, part.type)
      }

      const nextMessage = {
        ...message,
        parts: paritySafeParts,
      } as UIMessage

      return addFallbackAssistantText(nextMessage, warnings, messageIndex)
    })

    const pass2Messages: UIMessage[] = []

    for (let index = 0; index < pass1Messages.length; index += 1) {
      const current = pass1Messages[index]
      const previous = pass2Messages[pass2Messages.length - 1]

      if (!previous || previous.role !== current.role) {
        pass2Messages.push(current)
        continue
      }

      warnings.push({
        code: "role_alternation_repaired",
        messageIndex: index,
        detail: `Merged consecutive ${current.role} messages to preserve Gemini role alternation.`,
      })

      if (current.role === "user") {
        pass2Messages[pass2Messages.length - 1] = mergeUserTextParts(
          previous,
          current
        )
      } else if (current.role === "assistant") {
        const mergedAssistant = {
          ...previous,
          parts: [...previous.parts, ...current.parts],
        } as UIMessage

        const paritySafeMerged = {
          ...mergedAssistant,
          parts: enforceFcFrParity(
            mergedAssistant.parts.map(toPart),
            index,
            warnings,
            stats
          ),
        } as UIMessage

        pass2Messages[pass2Messages.length - 1] = addFallbackAssistantText(
          paritySafeMerged,
          warnings,
          index
        )
      } else {
        pass2Messages.push(current)
      }
    }

    const finalMessages = context.targetModelId.startsWith("gemini-3")
      ? injectGemini3ThoughtSignatures(
          pass2Messages,
          warnings,
          stats,
          Math.max(0, pass2Messages.length - 1)
        )
      : pass2Messages

    return finalMessages
  },
})
