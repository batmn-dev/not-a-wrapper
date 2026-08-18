import { sanitizeVisibleChatMessages } from "@/convex/domain/message_visibility"
import { readServerMessageId } from "@/lib/chat-messages/branch"
import type {
  ChatTurnBodyFields,
  ChatTurnEditRequest,
  ChatTurnRegenerationRequest,
  ChatTurnSelectedPathToken,
} from "@/lib/chat-messages/chat-turn-contract"
import type { DurableMessageStatus } from "@/lib/chat-messages/durable-contract"
import { SYSTEM_PROMPT_DEFAULT } from "@/lib/config"
import type { UIMessage } from "ai"

// Chat turn controller internals — the pure planning half: given the visible
// messages and the turn's inputs, produce the validated plan (edit trim,
// regeneration target, staleness token) and the wire-contract body. No state,
// no dispatch; the runners in chat-turn-controller.ts consume these.

export type ChatTurnMessage = UIMessage & {
  createdAt?: Date
  status?: DurableMessageStatus
}

export type SendFilePart = {
  type: "file"
  filename: string
  mediaType: string
  url: string
  attachmentId?: string
}

type BuildChatTurnRequestBodyArgs = {
  chatId: string
  userId: string
  selectedModel: string
  systemPrompt?: string
  enableSearch?: boolean
  chatVersion?: number
  selectedPathToken?: ChatTurnSelectedPathToken
  edit?: ChatTurnEditRequest
  regeneration?: ChatTurnRegenerationRequest
}

// Produces the Chat turn wire contract's body fields (CONTEXT.md;
// lib/chat-messages/chat-turn-contract.ts). Closed on purpose: identity is
// session-derived server-side, so `isAuthenticated` never rides along, and
// there is no extras spread — a new wire field is added on the contract first.
export function buildChatTurnRequestBody({
  chatId,
  userId,
  selectedModel,
  systemPrompt,
  enableSearch,
  chatVersion,
  selectedPathToken,
  edit,
  regeneration,
}: BuildChatTurnRequestBodyArgs): ChatTurnBodyFields {
  return {
    chatId,
    userId,
    model: selectedModel,
    systemPrompt: systemPrompt || SYSTEM_PROMPT_DEFAULT,
    ...(enableSearch !== undefined ? { enableSearch } : {}),
    ...(chatVersion !== undefined ? { chatVersion } : {}),
    ...(selectedPathToken
      ? {
          expectedVisibleMessageCount:
            selectedPathToken.expectedVisibleMessageCount,
          ...(selectedPathToken.tailMessageId
            ? { tailMessageId: selectedPathToken.tailMessageId }
            : {}),
        }
      : {}),
    ...(edit ? { edit } : {}),
    ...(regeneration ? { regeneration } : {}),
  }
}

export function buildSelectedPathToken(
  messages: ChatTurnMessage[]
): ChatTurnSelectedPathToken {
  const visibleMessages = sanitizeVisibleChatMessages(messages)
  const tailMessage = visibleMessages[visibleMessages.length - 1]
  const tailMessageId = tailMessage
    ? readServerMessageId(tailMessage.metadata)
    : undefined

  return {
    expectedVisibleMessageCount: visibleMessages.length,
    ...(tailMessageId ? { tailMessageId } : {}),
  }
}

type PrepareEditTurnPlanArgs = {
  messages: ChatTurnMessage[]
  messageId: string
  newContent: string
  createOptimisticEditMessageId: () => string
}

export type EditTurnPlan =
  | {
      ok: true
      originalMessages: ChatTurnMessage[]
      trimmedMessages: ChatTurnMessage[]
      /** The replacement user message. The edit runner sends it (id, parts)
       * through the SDK and the edit intent tells the server to persist its id
       * as clientMessageId, so live and durable identity stay matched. */
      optimisticEditedMessage: ChatTurnMessage
      cutoffTimestamp: number
      chatVersion: number
      expectedChatVersion: number
      shouldUpdateTitle: boolean
      title: string
    }
  | {
      ok: false
      reason: "message-not-found" | "missing-message-timestamp"
    }

export function prepareEditTurnPlan({
  messages,
  messageId,
  newContent,
  createOptimisticEditMessageId,
}: PrepareEditTurnPlanArgs): EditTurnPlan {
  const visibleMessages = sanitizeVisibleChatMessages(messages)
  const editIndex = visibleMessages.findIndex(
    (message) => String(message.id) === String(messageId)
  )
  if (editIndex === -1) return { ok: false, reason: "message-not-found" }

  const target = visibleMessages[editIndex]
  const cutoffTimestamp = target?.createdAt?.getTime()
  if (!target || !cutoffTimestamp) {
    return { ok: false, reason: "missing-message-timestamp" }
  }

  const trimmedMessages = visibleMessages.slice(0, editIndex)
  const targetFileParts =
    target.parts?.filter((part) => part.type === "file") || []
  const optimisticEditedMessage: ChatTurnMessage = {
    id: createOptimisticEditMessageId(),
    role: "user",
    createdAt: new Date(),
    parts: [{ type: "text", text: newContent }, ...targetFileParts],
  }

  return {
    ok: true,
    originalMessages: [...visibleMessages],
    trimmedMessages,
    optimisticEditedMessage,
    cutoffTimestamp,
    chatVersion: trimmedMessages.length + 1,
    expectedChatVersion: visibleMessages.length,
    shouldUpdateTitle: editIndex === 0 && target.role === "user",
    title: newContent,
  }
}

export function buildEditRequest(
  editedMessageId: string,
  plan: Extract<EditTurnPlan, { ok: true }>
): ChatTurnEditRequest {
  return {
    editedMessageId,
    editCutoffTimestamp: plan.cutoffTimestamp,
    expectedChatVersion: plan.expectedChatVersion,
    replacementMessage: {
      id: plan.optimisticEditedMessage.id,
      role: "user",
      content: plan.title,
      parts: plan.optimisticEditedMessage.parts,
    },
    ...(plan.shouldUpdateTitle ? { regenerateTitle: true } : {}),
  }
}

export type RegenerationTurnPlan =
  | {
      ok: true
      originalMessages: ChatTurnMessage[]
      retainedMessages: ChatTurnMessage[]
      regeneration: ChatTurnRegenerationRequest
    }
  | {
      ok: false
      reason:
        | "message-not-found"
        | "invalid-target-role"
        | "missing-message-timestamp"
        | "missing-preceding-user"
    }

function getMessageCreatedAtMs(message: ChatTurnMessage): number | undefined {
  const createdAt = (message as { createdAt?: unknown }).createdAt
  if (createdAt instanceof Date) return createdAt.getTime()
  if (typeof createdAt === "number" && Number.isFinite(createdAt)) {
    return createdAt
  }
  if (typeof createdAt === "string") {
    const parsed = Date.parse(createdAt)
    return Number.isNaN(parsed) ? undefined : parsed
  }
  return undefined
}

export function prepareRegenerationTurnPlan(
  messages: ChatTurnMessage[],
  targetAssistantMessageId: string
): RegenerationTurnPlan {
  const visibleMessages = sanitizeVisibleChatMessages(messages)
  const targetIndex = visibleMessages.findIndex(
    (message) => String(message.id) === String(targetAssistantMessageId)
  )
  if (targetIndex === -1) return { ok: false, reason: "message-not-found" }

  const target = visibleMessages[targetIndex]
  if (!target || target.role !== "assistant") {
    return { ok: false, reason: "invalid-target-role" }
  }

  // No tail restriction: any assistant on the visible path may be regenerated.
  // A non-tail target forks the thread at the preceding user message — the
  // backend creates a selected sibling and the projection seam renders the
  // fork, surfacing the old continuation via branch nav on the user message.
  const targetAssistantCreatedAt = getMessageCreatedAtMs(target)
  if (targetAssistantCreatedAt === undefined) {
    return { ok: false, reason: "missing-message-timestamp" }
  }

  let precedingUser: ChatTurnMessage | undefined
  let precedingUserIndex = -1
  for (let index = targetIndex - 1; index >= 0; index--) {
    const candidate = visibleMessages[index]
    if (candidate?.role !== "user") continue
    precedingUser = candidate
    precedingUserIndex = index
    break
  }

  if (!precedingUser) {
    return { ok: false, reason: "missing-preceding-user" }
  }

  return {
    ok: true,
    originalMessages: [...visibleMessages],
    retainedMessages: visibleMessages.slice(0, precedingUserIndex + 1),
    regeneration: {
      targetAssistantMessageId: String(target.id),
      targetAssistantCreatedAt,
      expectedChatVersion: visibleMessages.length,
      precedingUserMessageId: String(precedingUser.id),
    },
  }
}
