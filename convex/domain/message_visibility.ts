type DurableMessageLike = {
  role?: unknown
  content?: unknown
  parts?: unknown
  status?: unknown
}

function isSemanticPart(part: unknown): boolean {
  if (!part || typeof part !== "object") return false

  const record = part as { type?: unknown; text?: unknown }
  if (typeof record.type !== "string" || record.type.length === 0) {
    return false
  }

  if (record.type === "step-start") return false

  if (record.type === "text" || record.type === "reasoning") {
    return typeof record.text === "string" && record.text.length > 0
  }

  return true
}

export function hasSemanticMessageParts(
  message: DurableMessageLike
): boolean {
  if (Array.isArray(message.parts) && message.parts.some(isSemanticPart)) {
    return true
  }

  return typeof message.content === "string" && message.content.length > 0
}

export function hasSemanticAssistantParts(
  message: DurableMessageLike
): boolean {
  return message.role === "assistant" && hasSemanticMessageParts(message)
}

export function isVisibleChatMessage(message: DurableMessageLike): boolean {
  if (message.role !== "assistant") return true
  return hasSemanticAssistantParts(message)
}

export function isModelHistoryMessage(message: DurableMessageLike): boolean {
  if (message.role !== "assistant") return true
  return hasSemanticAssistantParts(message)
}
