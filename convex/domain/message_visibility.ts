type DurableMessageLike = {
  role?: unknown
  content?: unknown
  parts?: unknown
  status?: unknown
}

export function isSemanticMessagePart(part: unknown): boolean {
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

export function hasSemanticMessageParts(message: DurableMessageLike): boolean {
  if (
    Array.isArray(message.parts) &&
    message.parts.some(isSemanticMessagePart)
  ) {
    return true
  }

  return typeof message.content === "string" && message.content.length > 0
}

export function normalizeSemanticMessageParts<T extends DurableMessageLike>(
  message: T
): T {
  if (
    Array.isArray(message.parts) &&
    message.parts.some(isSemanticMessagePart)
  ) {
    return message
  }

  if (typeof message.content !== "string" || message.content.length === 0) {
    return message
  }

  return {
    ...message,
    parts: [{ type: "text", text: message.content }],
  }
}

export function hasSemanticAssistantParts(
  message: DurableMessageLike
): boolean {
  return message.role === "assistant" && hasSemanticMessageParts(message)
}

export function isEmptyAssistantMessage(message: DurableMessageLike): boolean {
  return message.role === "assistant" && !hasSemanticAssistantParts(message)
}

export function isVisibleChatMessage(message: DurableMessageLike): boolean {
  if (message.role !== "assistant") return true
  return hasSemanticAssistantParts(message)
}

export function sanitizeVisibleChatMessages<T extends DurableMessageLike>(
  messages: T[]
): T[] {
  return messages
    .map(normalizeSemanticMessageParts)
    .filter(isVisibleChatMessage)
}

export function isModelHistoryMessage(message: DurableMessageLike): boolean {
  if (message.role !== "assistant") return true
  return hasSemanticAssistantParts(message)
}

export function sanitizeModelHistoryMessages<T extends DurableMessageLike>(
  messages: T[]
): T[] {
  return messages
    .map(normalizeSemanticMessageParts)
    .filter(isModelHistoryMessage)
}
