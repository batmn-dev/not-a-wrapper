import { UIMessage as MessageAISDK } from "ai"
import type { ModelMessage } from "ai"

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

/**
 * Check if a message contains tool-related content
 * In v5, tool parts have types starting with 'tool-' in the parts array
 */
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
 * @deprecated Phase 7 cleanup: `app/api/chat/route.ts` now always uses
 * `adaptHistoryForProvider()`. Keep this only as a test/reference shim until
 * adapter parity tests are fully retired.
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
    error instanceof Error &&
    error.message.includes("ArgumentValidationError")
  )
}

/**
 * Exclude system-role messages from model-input history. ai@7 rejects
 * system-role messages inside `messages` (`allowSystemInMessages` defaults to
 * false; the system prompt rides streamText's `instructions`), where ai@6
 * forwarded them to the provider. A system-role message in this app's history
 * is never a real instruction — it is a legacy `data`-role artifact (the UI
 * message adapter maps data/unknown stored roles to "system") or arrived
 * client-supplied on a guest chat — so model input drops it rather than
 * restoring the v6 behavior via `allowSystemInMessages: true`, which would
 * hand user-controllable history system-level privilege. Returns the input
 * array unchanged (same reference) when nothing is excluded.
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
 * Detect provider-linked response item identifiers in converted model messages.
 * These IDs (msg_/rs_/ws_) can trigger replay pairing errors in Responses APIs
 * when the required companion items are not present.
 */
export function hasProviderLinkedResponseIds(
  modelMessages: ModelMessage[]
): boolean {
  try {
    const serialized = JSON.stringify(modelMessages)
    return /\b(?:msg|rs|ws)_[a-zA-Z0-9]+\b/.test(serialized)
  } catch {
    return false
  }
}

/**
 * Build a conservative plain-text transcript from UI messages.
 * Used as a safety fallback when provider-linked replay artifacts are detected.
 */
export function toPlainTextModelMessages(
  messages: MessageAISDK[]
): ModelMessage[] {
  const modelMessages: ModelMessage[] = []

  for (const message of messages) {
    if (
      message.role !== "system" &&
      message.role !== "user" &&
      message.role !== "assistant"
    ) {
      continue
    }

    const text = (message.parts || [])
      .filter((part) => part.type === "text")
      .map((part) => ("text" in part ? (part.text ?? "") : ""))
      .join("\n\n")

    modelMessages.push({
      role: message.role,
      content: text,
    })
  }

  return modelMessages
}

/**
 * Structured error type for API responses
 */
export type ApiError = Error & {
  statusCode: number
  code: string
}

/**
 * Parse and handle stream errors from AI SDK
 * @deprecated Use extractErrorMessage instead for errors surfaced through the UI message stream's onError
 * This is kept for legacy/fallback purposes or non-streaming error scenarios
 * @param err - The error from streamText onError callback
 * @returns Structured error with status code and error code
 */
export function handleStreamError(err: unknown): ApiError {
  console.error("🛑 streamText error:", err)

  // Extract error details from the AI SDK error

  const aiError = (err as { error?: any })?.error

  if (aiError) {
    // Try to extract detailed error message from response body
    let detailedMessage = ""
    if (aiError.responseBody) {
      try {
        const parsed = JSON.parse(aiError.responseBody)
        // Handle different error response formats
        if (parsed.error?.message) {
          detailedMessage = parsed.error.message
        } else if (parsed.error && typeof parsed.error === "string") {
          detailedMessage = parsed.error
        } else if (parsed.message) {
          detailedMessage = parsed.message
        }
      } catch {
        // Fallback to generic message if parsing fails
      }
    }

    // Handle specific API errors with proper status codes
    if (aiError.statusCode === 402) {
      // Payment required
      const message =
        detailedMessage || "Insufficient credits or payment required"
      return Object.assign(new Error(message), {
        statusCode: 402,
        code: "PAYMENT_REQUIRED",
      })
    } else if (aiError.statusCode === 401) {
      // Authentication error - use detailed message if available
      const message =
        detailedMessage ||
        "Invalid API key or authentication failed. Please check your API key in settings."
      return Object.assign(new Error(message), {
        statusCode: 401,
        code: "AUTHENTICATION_ERROR",
      })
    } else if (aiError.statusCode === 429) {
      // Rate limit
      const message =
        detailedMessage || "Rate limit exceeded. Please try again later."
      return Object.assign(new Error(message), {
        statusCode: 429,
        code: "RATE_LIMIT_EXCEEDED",
      })
    } else if (aiError.statusCode >= 400 && aiError.statusCode < 500) {
      // Other client errors
      const message = detailedMessage || aiError.message || "Request failed"
      return Object.assign(new Error(message), {
        statusCode: aiError.statusCode,
        code: "CLIENT_ERROR",
      })
    } else {
      // Server errors or other issues
      const message = detailedMessage || aiError.message || "AI service error"
      return Object.assign(new Error(message), {
        statusCode: aiError.statusCode || 500,
        code: "SERVER_ERROR",
      })
    }
  } else {
    // Fallback for unknown error format
    return Object.assign(
      new Error("AI generation failed. Please check your model or API key."),
      {
        statusCode: 500,
        code: "UNKNOWN_ERROR",
      }
    )
  }
}

/**
 * Extract a user-friendly error message from various error types
 * Used for streaming errors that need to be forwarded to the client
 * @param error - The error from AI SDK or other sources
 * @returns User-friendly error message string
 */
export function extractErrorMessage(error: unknown): string {
  // Handle null/undefined
  if (error == null) {
    return "An unknown error occurred."
  }

  // Handle string errors
  if (typeof error === "string") {
    return error
  }

  // Try to extract the provider name from the error for more helpful messages
  const providerHint = extractProviderHint(error)

  // Handle Error objects
  if (error instanceof Error) {
    // Check for specific error patterns
    if (
      error.message.includes("invalid x-api-key") ||
      error.message.includes("authentication_error") ||
      error.message.includes("Incorrect API key")
    ) {
      return `Invalid API key${providerHint}. Please check your API key in settings.`
    } else if (
      error.message.includes("402") ||
      error.message.includes("payment") ||
      error.message.includes("credits")
    ) {
      return `Insufficient credits or payment required${providerHint}.`
    } else if (
      error.message.includes("429") ||
      error.message.includes("rate limit")
    ) {
      return "Rate limit exceeded. Please try again later."
    }

    return error.message
  }

  // Handle AI SDK error objects

  const aiError = (
    error as {
      error?: { statusCode?: number; responseBody?: string; message?: string }
    }
  )?.error
  if (aiError) {
    // Try to extract a detailed message from the response body
    const detailedMessage = extractResponseBodyMessage(aiError.responseBody)

    if (aiError.statusCode === 401) {
      return (
        detailedMessage ||
        `Invalid API key${providerHint}. Please check your API key in settings.`
      )
    } else if (aiError.statusCode === 402) {
      return (
        detailedMessage ||
        `Insufficient credits or payment required${providerHint}.`
      )
    } else if (aiError.statusCode === 429) {
      return detailedMessage || "Rate limit exceeded. Please try again later."
    } else if (detailedMessage) {
      return detailedMessage
    }

    return aiError.message || "Request failed"
  }

  return "An error occurred. Please try again."
}

/**
 * Try to extract the AI provider name from an error for more helpful messages
 */
function extractProviderHint(error: unknown): string {
  let errorStr: string
  if (error instanceof Error) {
    errorStr = error.message + (error.stack || "")
  } else {
    try {
      errorStr = JSON.stringify(error)
    } catch {
      errorStr = String(error)
    }
  }

  if (errorStr.includes("anthropic") || errorStr.includes("x-api-key")) {
    return " for Anthropic"
  }
  if (
    errorStr.includes("openai.com") ||
    errorStr.includes("Incorrect API key provided")
  ) {
    return " for OpenAI"
  }
  if (
    errorStr.includes("generativelanguage.googleapis") ||
    errorStr.includes("google")
  ) {
    return " for Google"
  }
  if (errorStr.includes("mistral")) {
    return " for Mistral"
  }
  if (errorStr.includes("perplexity")) {
    return " for Perplexity"
  }
  if (errorStr.includes("x.ai") || errorStr.includes("xai")) {
    return " for xAI"
  }
  return ""
}

/**
 * Try to extract an error message from an AI SDK response body
 */
function extractResponseBodyMessage(responseBody?: string): string | null {
  if (!responseBody) return null
  try {
    const parsed = JSON.parse(responseBody)
    return parsed.error?.message || null
  } catch {
    return null
  }
}

/**
 * Create error response for API endpoints
 * @param error - Error object with optional statusCode and code
 * @returns Response object with proper status and JSON body
 */
export function createErrorResponse(error: {
  code?: string
  message?: string
  statusCode?: number
}): Response {
  // Handle daily limit first (existing logic)
  if (error.code === "DAILY_LIMIT_REACHED") {
    return new Response(
      JSON.stringify({ error: error.message, code: error.code }),
      { status: 403 }
    )
  }

  // Handle stream errors with proper status codes
  if (error.statusCode) {
    return new Response(
      JSON.stringify({
        error: error.message || "Request failed",
        code: error.code || "REQUEST_ERROR",
      }),
      { status: error.statusCode }
    )
  }

  // Fallback for other errors
  return new Response(
    JSON.stringify({ error: error.message || "Internal server error" }),
    { status: 500 }
  )
}
