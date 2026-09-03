import { isChatPublicId } from "@/lib/chat-store/identity"
import type { ModelReasoningEffort } from "@/lib/models/types"
import { isModelReasoningEffort } from "@/lib/models/types"
import { isGenerationBudget } from "@/lib/openproviders/output-budget"
import type { UIMessage } from "ai"

// Chat turn wire contract (CONTEXT.md): the single statement of the
// POST /api/chat request shape. The Chat turn controller's plan builders
// (`lib/chat-turn/turn-plans.ts`) produce `ChatTurnBodyFields`;
// the AI SDK transport merges in `messages`; the chat route validates the
// result through `parseChatTurnRequest` before handing it to the Chat turn
// runtime. Both sides import THIS module — the shape is declared once, so a
// field added or renamed on one side is a compile error on the other, not a
// production bug.
//
// Trust notes (ADR-0010): caller identity is derived server-side from the
// WorkOS session, never from this body. `userId` is read only for guest
// (unauthenticated) turns, as a stable rate-limit key; for authenticated
// sessions it is ignored. There is deliberately no `isAuthenticated` field on
// the wire.

/**
 * Server-owned edit: a durable Chat turn that rewrites a prior user message,
 * branching the selected path. Carries its own count guard
 * (`expectedChatVersion`) rather than the Selected path token.
 */
export type ChatTurnEditRequest = {
  editedMessageId: string
  editCutoffTimestamp: number
  expectedChatVersion: number
  replacementMessage: {
    id: string
    role: "user"
    content: string
    parts: UIMessage["parts"]
  }
  /** First-user-message edits request a fresh generated title. The server
   * ignores this when the owner has manually renamed the chat. */
  regenerateTitle?: boolean
}

/**
 * Server-owned regeneration: a durable Chat turn that produces a new assistant
 * branch for an existing user message. Carries its own count guard.
 */
export type ChatTurnRegenerationRequest = {
  targetAssistantMessageId: string
  targetAssistantCreatedAt: number
  expectedChatVersion: number
  precedingUserMessageId: string
}

/**
 * The forward staleness guard for a new-message turn, derived by the client
 * from the rendered selected path (CONTEXT.md "Selected path token"). Spread
 * flat into the body fields, not nested.
 */
export type ChatTurnSelectedPathToken = {
  expectedVisibleMessageCount: number
  tailMessageId?: string
}

/**
 * The body fields the client turn builder produces. Closed: there is no
 * extras escape hatch — a new field is added here, on both sides at once.
 * `messages` is absent because the AI SDK transport merges it in at dispatch.
 */
export type ChatTurnBodyFields = {
  chatId: string
  /** Guest rate-limit key. Required for unauthenticated turns
   * (`MISSING_GUEST_ID` otherwise); ignored when a session exists. */
  userId?: string
  model: string
  /** Optional on the wire: the parser does not require it and the Chat turn
   * runtime falls back to `SYSTEM_PROMPT_DEFAULT`. The client builder always
   * sends one. */
  systemPrompt?: string
  enableSearch?: boolean
  /** Per-turn reasoning-effort selection (ADR-0026). Absent = Default (the
   * provider decides). Untrusted: the parser drops unknown values and the
   * Chat turn runtime clamps to the resolved route's supported levels. */
  reasoningEffort?: ModelReasoningEffort
  /** Optional total generation allowance, including hidden reasoning tokens.
   * Absent = Auto. Present invalid values fail closed because this controls
   * provider spend. */
  generationBudget?: number
  chatVersion?: number
  expectedVisibleMessageCount?: number
  tailMessageId?: string
  edit?: ChatTurnEditRequest
  regeneration?: ChatTurnRegenerationRequest
}

/** The full wire shape the server consumes: body fields + the SDK's messages. */
export type ChatTurnWireRequest = ChatTurnBodyFields & {
  messages: UIMessage[]
}

export type ChatTurnRequestRejection = {
  ok: false
  status: number
  code: "INVALID_REQUEST" | "INVALID_GENERATION_BUDGET" | "MISSING_GUEST_ID"
  error: string
  details?: Record<string, string>
  /** True when the rejection represents a state our own client should never
   * produce (a contract violation, not routine bad input), so the route
   * captures it to Sentry instead of dropping it as an expected 400. */
  unexpected?: boolean
}

export type ChatTurnRequestParseResult =
  { ok: true; request: ChatTurnWireRequest } | ChatTurnRequestRejection

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

/**
 * Validate an already-JSON-parsed request body against the wire contract.
 * `isAuthenticated` comes from the server-side session (never the body) and
 * gates only the guest-id rule. Unknown keys are ignored, not rejected — the
 * contract is closed at the type level, tolerant at the wire level.
 */
export function parseChatTurnRequest(
  body: unknown,
  context: { isAuthenticated: boolean }
): ChatTurnRequestParseResult {
  const record: Record<string, unknown> = isRecord(body) ? body : {}
  const { messages, chatId, model } = record

  // The chat id is the client-minted publicId (ADR-0033); its UUID shape is
  // the only client-side identity check, so a malformed id is a 400 here and
  // never reaches the durable contract.
  if (
    !Array.isArray(messages) ||
    !isChatPublicId(chatId) ||
    !isNonEmptyString(model)
  ) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_REQUEST",
      error: "Missing required fields",
      details: {
        messages: Array.isArray(messages) ? "ok" : "required",
        chatId: isChatPublicId(chatId) ? "ok" : "required",
        model: isNonEmptyString(model) ? "ok" : "required",
      },
    }
  }

  if (record.edit && record.regeneration) {
    // Edit and regeneration are mutually exclusive by client construction, so
    // both present means a client bug worth surfacing — not routine bad input.
    return {
      ok: false,
      status: 400,
      code: "INVALID_REQUEST",
      error: "Regeneration cannot be combined with edit generation",
      unexpected: true,
    }
  }

  if (!context.isAuthenticated && !record.userId) {
    return {
      ok: false,
      status: 400,
      code: "MISSING_GUEST_ID",
      error: "Guest ID required for anonymous users",
    }
  }

  // Routine bad input, not a contract violation: an unknown effort value
  // (stale client, hand-crafted request) degrades to Default rather than 400.
  if (
    record.reasoningEffort !== undefined &&
    !isModelReasoningEffort(record.reasoningEffort)
  ) {
    delete record.reasoningEffort
  }

  if (
    record.generationBudget !== undefined &&
    !isGenerationBudget(record.generationBudget)
  ) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_GENERATION_BUDGET",
      error:
        "Generation budget must be a positive whole number within the supported range",
    }
  }

  return { ok: true, request: record as ChatTurnWireRequest }
}
