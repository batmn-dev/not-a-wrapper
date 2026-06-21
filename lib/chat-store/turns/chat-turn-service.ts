import {
  hasSemanticAssistantParts as hasSharedSemanticAssistantParts,
  isEmptyAssistantMessage as isSharedEmptyAssistantMessage,
  sanitizeVisibleChatMessages,
} from "@/convex/domain/message_visibility"
import { readServerMessageId } from "@/lib/chat-messages/branch"
import type { DurableMessageStatus } from "@/lib/chat-messages/durable-contract"
import { SYSTEM_PROMPT_DEFAULT } from "@/lib/config"
import type { UIMessage } from "ai"
import { getMessagePersistenceMode } from "../identity"
import { cacheMessages, getCachedMessages } from "../messages/api"

export type ChatTurnMessage = UIMessage & {
  createdAt?: Date
  status?: DurableMessageStatus
}

export type SetChatTurnMessages = (
  updater: (messages: ChatTurnMessage[]) => ChatTurnMessage[]
) => void

export type SendFilePart = {
  type: "file"
  filename: string
  mediaType: string
  url: string
  attachmentId?: string
}

export type PendingEdit = {
  message: ChatTurnMessage
  chatId: string
}

export type ChatTurnEditIntent = {
  editedMessageId: string
  editCutoffTimestamp: number
  expectedChatVersion: number
  replacementMessage: {
    id: string
    role: "user"
    content: string
    parts: ChatTurnMessage["parts"]
  }
  title?: string
}

export type ChatTurnRegenerationIntent = {
  targetAssistantMessageId: string
  targetAssistantCreatedAt: number
  expectedChatVersion: number
  precedingUserMessageId: string
}

export type ChatTurnSelectedPathToken = {
  expectedVisibleMessageCount: number
  tailMessageId?: string
}

export type ChatTurnRequestBody = {
  chatId: string | null
  userId: string
  model: string
  isAuthenticated: boolean
  systemPrompt: string
  enableSearch?: boolean
  chatVersion?: number
  expectedVisibleMessageCount?: number
  tailMessageId?: string
  edit?: ChatTurnEditIntent
  regeneration?: ChatTurnRegenerationIntent
  [key: string]: unknown
}

type BuildChatTurnRequestBodyArgs = {
  chatId: string | null
  userId: string
  selectedModel: string
  isAuthenticated: boolean
  systemPrompt?: string
  enableSearch?: boolean
  chatVersion?: number
  selectedPathToken?: ChatTurnSelectedPathToken
  edit?: ChatTurnEditIntent
  regeneration?: ChatTurnRegenerationIntent
  bodyExtras?: Record<string, unknown>
}

export function buildChatTurnRequestBody({
  chatId,
  userId,
  selectedModel,
  isAuthenticated,
  systemPrompt,
  enableSearch,
  chatVersion,
  selectedPathToken,
  edit,
  regeneration,
  bodyExtras = {},
}: BuildChatTurnRequestBodyArgs): ChatTurnRequestBody {
  return {
    chatId,
    userId,
    model: selectedModel,
    isAuthenticated,
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
    ...bodyExtras,
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

export function routePersistsChatMessages(
  chatId: string | null,
  isAuthenticated: boolean
) {
  return Boolean(
    chatId && isAuthenticated && getMessagePersistenceMode(chatId) === "server"
  )
}

export function messageFilePartsToSendFiles(
  parts: ChatTurnMessage["parts"]
): SendFilePart[] {
  return (parts ?? [])
    .filter((part) => part.type === "file")
    .map((part) => ({
      type: "file" as const,
      filename: (part as { filename?: string }).filename || "file",
      mediaType:
        (part as { mediaType?: string }).mediaType ||
        "application/octet-stream",
      url: (part as { url?: string }).url || "",
    }))
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
      optimisticEditedMessage: ChatTurnMessage
      sendFiles: SendFilePart[]
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
    sendFiles: messageFilePartsToSendFiles(targetFileParts),
    cutoffTimestamp,
    chatVersion: trimmedMessages.length + 1,
    expectedChatVersion: visibleMessages.length,
    shouldUpdateTitle: editIndex === 0 && target.role === "user",
    title: newContent,
  }
}

export function buildEditIntent(
  editedMessageId: string,
  plan: Extract<EditTurnPlan, { ok: true }>
): ChatTurnEditIntent {
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
    ...(plan.shouldUpdateTitle ? { title: plan.title } : {}),
  }
}

export type RegenerationTurnPlan =
  | {
      ok: true
      originalMessages: ChatTurnMessage[]
      retainedMessages: ChatTurnMessage[]
      regeneration: ChatTurnRegenerationIntent
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

export function hasSemanticAssistantParts(message: ChatTurnMessage): boolean {
  return hasSharedSemanticAssistantParts(message)
}

export function isEmptyAssistantMessage(message: ChatTurnMessage): boolean {
  return isSharedEmptyAssistantMessage(message)
}

export type ChatTurnStoreAdapters = {
  isAuthenticated: () => boolean
  updateMessages: SetChatTurnMessages
  cacheAndAddMessage: (
    message: ChatTurnMessage,
    overrideChatId?: string
  ) => void | Promise<void>
  updateTitle: (chatId: string, title: string) => void | Promise<void>
  pendingEdit: {
    get: () => PendingEdit | null
    stage: (message: ChatTurnMessage, chatId: string) => void
    clear: () => void
  }
  getStoredGuestChatId: () => string | null
  readMessages?: (chatId: string) => Promise<ChatTurnMessage[]>
  writeMessages?: (
    chatId: string,
    messages: ChatTurnMessage[]
  ) => void | Promise<void>
  reportError: (message: string, error: unknown) => void
}

export type FinishChatTurnPersistenceArgs = {
  message: ChatTurnMessage
  isAbort: boolean
  isDisconnect: boolean
  isError: boolean
  chatId: string | null
  previousChatId: string | null
}

export function createChatTurnStore(adapters: ChatTurnStoreAdapters) {
  const routePersistsMessages = (chatId: string | null) =>
    routePersistsChatMessages(chatId, adapters.isAuthenticated())

  const persistTurnMessage = (message: ChatTurnMessage, chatId: string) => {
    if (routePersistsMessages(chatId)) return
    return adapters.cacheAndAddMessage(message, chatId)
  }

  const removeEmptyAssistantMessages = async (
    chatId: string,
    targetMessage?: ChatTurnMessage
  ) => {
    const targetId = targetMessage ? String(targetMessage.id) : null
    let removedVisible = false

    adapters.updateMessages((prev) => {
      const next = prev.filter((candidate) => {
        if (targetId && String(candidate.id) === targetId) {
          return !isEmptyAssistantMessage(candidate)
        }
        return !isEmptyAssistantMessage(candidate)
      })
      removedVisible = next.length !== prev.length
      return removedVisible ? next : prev
    })

    const readMessages = adapters.readMessages ?? getCachedMessages
    const writeMessages = adapters.writeMessages ?? cacheMessages
    const cachedMessages = await readMessages(chatId)
    const cleanedMessages = cachedMessages.filter((candidate) => {
      if (targetId && String(candidate.id) === targetId) {
        return !isEmptyAssistantMessage(candidate)
      }
      return !isEmptyAssistantMessage(candidate)
    })

    if (cleanedMessages.length !== cachedMessages.length) {
      await writeMessages(chatId, cleanedMessages)
    }
  }

  const finishTurn = async ({
    message,
    isAbort,
    isDisconnect,
    isError,
    chatId,
    previousChatId,
  }: FinishChatTurnPersistenceArgs) => {
    const effectiveChatId =
      chatId || previousChatId || adapters.getStoredGuestChatId()
    const routePersists = effectiveChatId
      ? routePersistsMessages(effectiveChatId)
      : false

    if (isAbort || isDisconnect || isError) {
      const pendingEdit = adapters.pendingEdit.get()
      if (pendingEdit) {
        adapters.pendingEdit.clear()
        if (!routePersistsMessages(pendingEdit.chatId)) {
          try {
            await adapters.cacheAndAddMessage(
              pendingEdit.message,
              pendingEdit.chatId
            )
          } catch (error) {
            adapters.pendingEdit.stage(pendingEdit.message, pendingEdit.chatId)
            adapters.reportError(
              "Failed to persist pending edited message on abort/error:",
              error
            )
          }
        }
      }

      if (!effectiveChatId) return

      if (isEmptyAssistantMessage(message)) {
        try {
          await removeEmptyAssistantMessages(effectiveChatId, message)
        } catch (error) {
          adapters.reportError(
            "Failed to remove empty assistant message after abort/error:",
            error
          )
        }
      } else if (!routePersists) {
        try {
          await adapters.cacheAndAddMessage(message, effectiveChatId)
        } catch (error) {
          adapters.reportError(
            "Failed to persist partial assistant message after abort/error:",
            error
          )
        }
      }

      return
    }

    if (effectiveChatId) {
      const pendingEdit = adapters.pendingEdit.get()

      if (pendingEdit) {
        adapters.pendingEdit.clear()
        if (!routePersists) {
          try {
            await adapters.cacheAndAddMessage(
              pendingEdit.message,
              pendingEdit.chatId
            )
          } catch (error) {
            adapters.reportError(
              "Failed to persist pending edited message:",
              error
            )
            return
          }
        }
      }

      if (!routePersists) {
        try {
          await adapters.cacheAndAddMessage(message, effectiveChatId)
        } catch (error) {
          adapters.reportError("Failed to persist assistant message:", error)
          return
        }
      }
    }
  }

  return {
    routePersistsMessages,
    persistTurnMessage,
    finishTurn,
    stagePendingEdit: adapters.pendingEdit.stage,
  }
}

export type ChatTurnStore = ReturnType<typeof createChatTurnStore>
