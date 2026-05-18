import type { ContentPart, Message } from "@/app/types/api.types"

const DEFAULT_STEP = 0

/**
 * Process messages to extract final assistant content
 * Note: With Convex, message saving is typically handled client-side via mutations.
 * This function is kept for processing message content structure.
 */
export function processFinalAssistantMessage(
  messages: Message[]
) {
  const parts: ContentPart[] = []
  const toolMap = new Map<string, ContentPart>()
  const textParts: string[] = []

  for (const msg of messages) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text") {
          textParts.push(part.text || "")
          parts.push(part)
        } else if (part.type === "tool-invocation" && part.toolInvocation) {
          const { toolCallId, state } = part.toolInvocation
          if (!toolCallId) continue

          const existing = toolMap.get(toolCallId)
          if (state === "result" || !existing) {
            toolMap.set(toolCallId, {
              ...part,
              toolInvocation: {
                ...part.toolInvocation,
                args: part.toolInvocation?.args || {},
              },
            })
          }
        } else if (part.type === "reasoning") {
          parts.push({
            type: "reasoning",
            reasoningText: part.text || "",
            details: [
              {
                type: "text",
                text: part.text || "",
              },
            ],
          })
        } else if (part.type === "step-start") {
          parts.push(part)
        }
      }
    } else if (msg.role === "tool" && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "tool-result") {
          const toolCallId = part.toolCallId || ""
          toolMap.set(toolCallId, {
            type: "tool-invocation",
            toolInvocation: {
              state: "result",
              step: DEFAULT_STEP,
              toolCallId,
              toolName: part.toolName || "",
              result: part.result,
            },
          })
        }
      }
    }
  }

  // Merge tool parts at the end
  parts.push(...toolMap.values())

  const finalPlainText = textParts.join("\n\n")

  return {
    content: finalPlainText || "",
    parts,
  }
}

/**
 * Save final assistant message
 * @deprecated Use Convex mutations client-side instead
 */
export async function saveFinalAssistantMessage(
  chatId: string,
  messages: Message[]
) {
  const { content, parts } = processFinalAssistantMessage(messages)

  // With Convex, this should be handled client-side via the MessagesProvider
  console.warn(
    "saveFinalAssistantMessage is deprecated - use Convex mutations instead"
  )
  console.log("Would save message for chat:", chatId, {
    content,
    parts,
  })
}
