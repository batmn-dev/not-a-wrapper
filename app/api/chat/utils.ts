import { UIMessage as MessageAISDK } from "ai"
import {
  isPublicChatHttpError,
  PublicChatHttpError,
} from "./public-http-error"

/**
 * Detect a Convex argument-validation rejection ("ArgumentValidationError" is
 * Convex's stable public error name; the client receives it as a generic Error
 * whose message embeds it). At the durable-prepare seam this means the request
 * named ids that pass the wire contract's shape checks but do not match the
 * durable contract — a client fault to map to a 400, not a 500 that leaks
 * Convex internals.
 */
export function isConvexArgumentValidationError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.includes("ArgumentValidationError")
  )
}

/** Keep malformed durable identifiers on one stable, client-safe 400 contract. */
export function toInvalidDurableRequestError(
  error: unknown
): PublicChatHttpError | null {
  if (!isConvexArgumentValidationError(error)) return null
  return new PublicChatHttpError({
    message: "Request does not reference a valid durable chat",
    statusCode: 400,
    code: "INVALID_REQUEST",
    cause: error,
  })
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
