type DurableMessageLike = {
  role?: unknown
  content?: unknown
  parts?: unknown
  status?: unknown
}

/**
 * Terminal outcomes that make an EMPTY assistant message renderable. A turn
 * that failed or was stopped before producing content has no semantic parts,
 * but its terminal status IS the content of the turn — deleting or hiding it
 * makes the thread lie: the user message reads as silently unanswered, and
 * later turns re-send it as duplicate history the model then re-answers.
 */
const TERMINAL_STUB_STATUSES = new Set<unknown>(["failed", "aborted"])

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
  return (
    Array.isArray(message.parts) && message.parts.some(isSemanticMessagePart)
  )
}

export function hasSemanticAssistantParts(
  message: DurableMessageLike
): boolean {
  return message.role === "assistant" && hasSemanticMessageParts(message)
}

export function isEmptyAssistantMessage(message: DurableMessageLike): boolean {
  return message.role === "assistant" && !hasSemanticAssistantParts(message)
}

/**
 * An empty assistant message whose run reached a terminal failed/aborted
 * outcome — the durable representation of "this turn died before producing
 * content". Rendered as an inline failed/stopped state with a retry
 * affordance; kept addressable so retry (a regeneration turn) can target it.
 */
export function isTerminalOutcomeStub(message: DurableMessageLike): boolean {
  return (
    isEmptyAssistantMessage(message) &&
    TERMINAL_STUB_STATUSES.has(message.status)
  )
}

export function isVisibleChatMessage(message: DurableMessageLike): boolean {
  if (message.role !== "assistant") return true
  return hasSemanticAssistantParts(message) || isTerminalOutcomeStub(message)
}

export function sanitizeVisibleChatMessages<T extends DurableMessageLike>(
  messages: T[]
): T[] {
  return messages.filter(isVisibleChatMessage)
}

export function isModelHistoryMessage(message: DurableMessageLike): boolean {
  if (message.role !== "assistant") return true
  return hasSemanticAssistantParts(message)
}

export function sanitizeModelHistoryMessages<T extends DurableMessageLike>(
  messages: T[]
): T[] {
  return messages.filter(isModelHistoryMessage)
}

const FAILED_TURN_HISTORY_MARKER =
  "[This response failed with an error before producing content.]"
const ABORTED_TURN_HISTORY_MARKER =
  "[This response was stopped before producing content.]"

/**
 * Project stored messages into model history. Ordinary empty assistant
 * messages (in-flight placeholders) are dropped as before; terminal
 * failed/aborted stubs are replaced with a one-line marker so the model sees
 * that the preceding user message was asked but never answered — without it,
 * an unanswered question reads as fresh and gets re-answered alongside the
 * next turn (the duplicate-history poisoning).
 */
export function projectModelHistoryMessages<T extends DurableMessageLike>(
  messages: T[]
): T[] {
  const projected: T[] = []
  for (const message of messages) {
    if (isTerminalOutcomeStub(message)) {
      const marker =
        message.status === "failed"
          ? FAILED_TURN_HISTORY_MARKER
          : ABORTED_TURN_HISTORY_MARKER
      projected.push({
        ...message,
        content: marker,
        parts: [{ type: "text", text: marker }],
      })
      continue
    }
    if (!isModelHistoryMessage(message)) continue
    projected.push(message)
  }
  return projected
}
