import { UIMessage as MessageAISDK } from "ai"
import type { ModelMessage } from "ai"
import { normalizeChatError, type PublicChatErrorContext } from "./public-error"
import {
  isPublicChatHttpError,
  type PublicChatHttpError,
} from "./public-http-error"

/**
 * Check if a part is tool-related (v5 uses parts with type starting with 'tool-')
 */
function isToolPart(part: { type: string }): boolean {
  return part.type.startsWith("tool-")
}

/**
 * Clean messages when switching between agents with different tool capabilities.
 * This removes tool invocations and tool-related content from messages when tools are not available
 * to prevent OpenAI API errors.
 *
 * In v5, messages use `parts` array instead of `content` and `toolInvocations`.
 */
export function cleanMessagesForTools(
  messages: MessageAISDK[],
  hasTools: boolean
): MessageAISDK[] {
  if (hasTools) {
    return messages
  }

  // If no tools available, clean all tool-related content
  const cleanedMessages = messages
    .map((message) => {
      // Skip tool messages entirely when no tools are available
      if ((message as { role: string }).role === "tool") {
        return null
      }

      // Filter out tool-related parts from the message
      const filteredParts = message.parts.filter((part) => !isToolPart(part))

      // If all parts were tool-related, provide a fallback text part
      if (filteredParts.length === 0) {
        return {
          ...message,
          parts: [{ type: "text" as const, text: "[Response]" }],
        }
      }

      // If parts were filtered, return updated message
      if (filteredParts.length !== message.parts.length) {
        return {
          ...message,
          parts: filteredParts,
        }
      }

      return message
    })
    .filter((message): message is MessageAISDK => message !== null)

  return cleanedMessages
}

/** Return whether a message contains a tool role or tool part. */
export function messageHasToolContent(message: MessageAISDK): boolean {
  return (
    (message as { role: string }).role === "tool" ||
    message.parts.some((part) => isToolPart(part))
  )
}

/**
 * Provider-specific message sanitization before convertToModelMessages().
 *
 * Anthropic requires reasoning/tool artifacts to be replayed for continuity.
 * For other providers, replaying those internal parts can cause responses API
 * validation errors when required paired items are missing.
 *
 * @deprecated Compatibility shim; the request path uses
 * `adaptHistoryForProvider()`.
 */
export function sanitizeMessagesForProvider(
  messages: MessageAISDK[],
  provider: string
): MessageAISDK[] {
  if (provider === "anthropic") return messages

  return messages
    .filter((message) => (message as { role: string }).role !== "tool")
    .map((message, index) => {
      const role = (message as { role: string }).role
      const base = {
        id: `${role}-${index}`,
        role: message.role,
      }

      if (role !== "assistant" || !message.parts) {
        return {
          ...base,
          parts: message.parts,
        } as MessageAISDK
      }

      const filteredParts = message.parts.filter((part) => {
        if (part.type === "reasoning") return false
        if (part.type === "step-start") return false
        if (part.type === "source-url") return false
        return !isToolPart(part)
      })

      return {
        ...base,
        // Always rebuild assistant parts to avoid replaying provider-specific
        // response item linkage from prior turns (e.g. OpenAI msg_/rs_ pairs).
        parts: filteredParts.length
          ? filteredParts
          : [{ type: "text" as const, text: "" }],
      } as MessageAISDK
    })
}

/**
 * Detect a Convex argument-validation rejection ("ArgumentValidationError" is
 * Convex's stable public error name; the client receives it as a generic Error
 * whose message embeds it). At the durable-prepare seam this means the request
 * named ids that pass the client-shape checks (`isServerChatId` is only
 * "not local, not optimistic") but do not match the durable contract — a
 * client fault to map to a 400, not a 500 that leaks Convex internals.
 */
export function isConvexArgumentValidationError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.includes("ArgumentValidationError")
  )
}

/**
 * Legacy diagnostic helper retained for repository-local offline probes. The
 * production replay path no longer scans serialized content or branches on
 * identifier-looking text; provider-hosted parts are projected structurally.
 */
export function hasProviderLinkedResponseIds(
  modelMessages: ModelMessage[]
): boolean {
  try {
    return /\b(?:msg|rs|ws)_[a-zA-Z0-9]+\b/.test(JSON.stringify(modelMessages))
  } catch {
    return false
  }
}

/**
 * Drop system-role history rather than enabling `allowSystemInMessages`.
 * These entries are legacy or client-controlled artifacts, not trusted
 * instructions; promoting them would cross a privilege boundary. Returns the
 * original array when no entry is excluded.
 */
export function excludeSystemRoleMessages(messages: MessageAISDK[]): {
  messages: MessageAISDK[]
  excludedCount: number
} {
  const filtered = messages.filter((message) => message.role !== "system")
  return filtered.length === messages.length
    ? { messages, excludedCount: 0 }
    : { messages: filtered, excludedCount: messages.length - filtered.length }
}

/**
 * Extract a user-friendly error message from various error types
 * Used for streaming errors that need to be forwarded to the client
 * @param error - The error from AI SDK or other sources
 * @returns User-friendly error message string
 */
export function extractErrorMessage(
  error: unknown,
  context: PublicChatErrorContext = {}
): string {
  return normalizeChatError(error, context).message
}

/**
 * Create error response for API endpoints.
 *
 * Message passthrough is a TRUST decision: only PublicChatHttpError instances
 * are app-authored, client-safe contracts. Arbitrary statusCode/code fields do
 * not confer trust because provider and SDK errors use the same property names.
 */
export function createErrorResponse(error: unknown): Response {
  if (isPublicChatHttpError(error)) {
    const publicError: PublicChatHttpError = error
    return new Response(
      JSON.stringify({
        error: publicError.message,
        code: publicError.code,
      }),
      { status: publicError.statusCode }
    )
  }

  // Everything else is an internal failure — never echo its message.
  return new Response(
    JSON.stringify({
      error: "An unexpected error occurred. Please try again.",
      code: "INTERNAL_ERROR",
    }),
    { status: 500 }
  )
}
