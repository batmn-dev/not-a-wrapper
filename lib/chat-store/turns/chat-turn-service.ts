import {
  hasSemanticAssistantParts as hasSharedSemanticAssistantParts,
  isEmptyAssistantMessage as isSharedEmptyAssistantMessage,
  sanitizeVisibleChatMessages,
} from "@/convex/domain/message_visibility"
import { SYSTEM_PROMPT_DEFAULT } from "@/lib/config"
import type { UIMessage } from "ai"
import { getMessagePersistenceMode } from "../identity"
import {
  cacheMessages,
  getCachedMessages,
  getLastMessagesFromDb,
} from "../messages/api"

export type ChatTurnMessage = UIMessage & { createdAt?: Date }

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

export type ChatTurnRequestBody = {
  chatId: string | null
  userId: string
  model: string
  isAuthenticated: boolean
  systemPrompt: string
  enableSearch?: boolean
  chatVersion?: number
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
    ...(edit ? { edit } : {}),
    ...(regeneration ? { regeneration } : {}),
    ...bodyExtras,
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
        | "unsupported-target"
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

  let lastAssistantIndex = -1
  for (let index = visibleMessages.length - 1; index >= 0; index--) {
    if (visibleMessages[index]?.role === "assistant") {
      lastAssistantIndex = index
      break
    }
  }

  if (
    targetIndex !== lastAssistantIndex ||
    targetIndex !== visibleMessages.length - 1
  ) {
    return { ok: false, reason: "unsupported-target" }
  }

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

export function reconcileRecentMessageIds(
  currentMessages: ChatTurnMessage[],
  recentMessages: ChatTurnMessage[]
): ChatTurnMessage[] {
  if (currentMessages.length === 0 || recentMessages.length === 0) {
    return currentMessages
  }

  const updated = [...currentMessages]
  let changed = false
  const existingIds = new Set(updated.map((message) => String(message.id)))
  const updatedIndices = new Set<number>()

  for (let dbIndex = recentMessages.length - 1; dbIndex >= 0; dbIndex--) {
    const dbMessage = recentMessages[dbIndex]
    if (!dbMessage) continue

    const dbId = String(dbMessage.id)
    const dbRole = dbMessage.role

    for (let localIndex = updated.length - 1; localIndex >= 0; localIndex--) {
      if (updatedIndices.has(localIndex)) continue

      const localMessage = updated[localIndex]
      if (!localMessage || localMessage.role !== dbRole) continue

      if (String(localMessage.id) === dbId) {
        updatedIndices.add(localIndex)
        break
      }

      if (!existingIds.has(dbId)) {
        existingIds.delete(String(localMessage.id))
        existingIds.add(dbId)
        updated[localIndex] = {
          ...localMessage,
          id: dbId,
          createdAt: dbMessage.createdAt,
        }
        changed = true
      }

      updatedIndices.add(localIndex)
      break
    }
  }

  return changed ? updated : currentMessages
}

export function hasSemanticAssistantParts(message: ChatTurnMessage): boolean {
  return hasSharedSemanticAssistantParts(message)
}

export function isEmptyAssistantMessage(message: ChatTurnMessage): boolean {
  return isSharedEmptyAssistantMessage(message)
}

type SyncRecentMessagesArgs = {
  chatId: string
  count?: number
  updateMessages: SetChatTurnMessages
  getRecentMessages?: (
    chatId: string,
    count: number
  ) => Promise<ChatTurnMessage[]>
  writeCachedMessages?: (
    chatId: string,
    messages: ChatTurnMessage[]
  ) => void | Promise<void>
}

export async function syncRecentMessagesFromStore({
  chatId,
  count = 2,
  updateMessages,
  getRecentMessages = getLastMessagesFromDb,
  writeCachedMessages = cacheMessages,
}: SyncRecentMessagesArgs): Promise<void> {
  const recentMessages = await getRecentMessages(chatId, count)
  if (!recentMessages || recentMessages.length === 0) return

  updateMessages((prev) => {
    const reconciled = reconcileRecentMessageIds(prev, recentMessages)
    if (reconciled !== prev) {
      void writeCachedMessages(chatId, reconciled)
    }
    return reconciled
  })
}

export type ChatTurnStoreAdapters = {
  isAuthenticated: () => boolean
  updateMessages: SetChatTurnMessages
  cacheAndAddMessage: (
    message: ChatTurnMessage,
    overrideChatId?: string
  ) => void | Promise<void>
  deleteMessagesFromTimestamp: (
    timestamp: number,
    minVersion?: number
  ) => Promise<void>
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
  getRecentMessages?: (
    chatId: string,
    count: number
  ) => Promise<ChatTurnMessage[]>
  writeCachedMessages?: (
    chatId: string,
    messages: ChatTurnMessage[]
  ) => void | Promise<void>
  reportError: (message: string, error: unknown) => void
}

export type ApplyEditTruncationArgs = {
  sourceChatId: string
  targetChatId: string
  plan: Extract<EditTurnPlan, { ok: true }>
}

export type StageRegenerationArgs = {
  chatId: string
  plan: Extract<RegenerationTurnPlan, { ok: true }>
}

export type PreparedEditPersistence = {
  routePersists: boolean
  accept: () => Promise<void>
  rollback: () => Promise<void>
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
  let activeLocalEdit: {
    chatId: string
    cachedSnapshot: ChatTurnMessage[]
    visibleSnapshot: ChatTurnMessage[]
  } | null = null
  let activeLocalRegeneration: {
    chatId: string
    retainedMessages: ChatTurnMessage[]
    visibleSnapshot: ChatTurnMessage[]
  } | null = null

  const routePersistsMessages = (chatId: string | null) =>
    routePersistsChatMessages(chatId, adapters.isAuthenticated())

  const persistTurnMessage = (message: ChatTurnMessage, chatId: string) => {
    if (routePersistsMessages(chatId)) return
    return adapters.cacheAndAddMessage(message, chatId)
  }

  const reconcileRecentMessages = async (chatId: string, count = 2) => {
    await syncRecentMessagesFromStore({
      chatId,
      count,
      updateMessages: adapters.updateMessages,
      getRecentMessages: adapters.getRecentMessages,
      writeCachedMessages: adapters.writeCachedMessages,
    })
  }

  const prepareEditPersistence = async ({
    sourceChatId,
    targetChatId,
    plan,
  }: ApplyEditTruncationArgs): Promise<PreparedEditPersistence> => {
    if (routePersistsMessages(targetChatId)) {
      return {
        routePersists: true,
        accept: async () => {},
        rollback: async () => {},
      }
    }

    const readMessages = adapters.readMessages ?? getCachedMessages
    const writeMessages = adapters.writeMessages ?? cacheMessages
    const cachedSnapshot = await readMessages(sourceChatId)

    const rollback = async () => {
      activeLocalEdit = null
      adapters.pendingEdit.clear()
      adapters.updateMessages(() => plan.originalMessages)
      await writeMessages(sourceChatId, cachedSnapshot)
    }

    return {
      routePersists: false,
      accept: async () => {
        await writeMessages(sourceChatId, plan.trimmedMessages)
        activeLocalEdit = {
          chatId: sourceChatId,
          cachedSnapshot,
          visibleSnapshot: plan.originalMessages,
        }

        if (plan.shouldUpdateTitle) {
          try {
            await adapters.updateTitle(targetChatId, plan.title)
          } catch {}
        }
      },
      rollback,
    }
  }

  const rollbackActiveLocalEdit = async () => {
    if (!activeLocalEdit) return false

    const transaction = activeLocalEdit
    activeLocalEdit = null
    adapters.pendingEdit.clear()
    adapters.updateMessages(() => transaction.visibleSnapshot)
    await (adapters.writeMessages ?? cacheMessages)(
      transaction.chatId,
      transaction.cachedSnapshot
    )
    return true
  }

  const stageRegeneration = ({ chatId, plan }: StageRegenerationArgs) => {
    if (routePersistsMessages(chatId)) return false

    activeLocalRegeneration = {
      chatId,
      retainedMessages: plan.retainedMessages,
      visibleSnapshot: plan.originalMessages,
    }
    return true
  }

  const rollbackActiveLocalRegeneration = () => {
    if (!activeLocalRegeneration) return false

    const transaction = activeLocalRegeneration
    activeLocalRegeneration = null
    adapters.updateMessages(() => transaction.visibleSnapshot)
    return true
  }

  const finishActiveLocalRegeneration = async (
    message: ChatTurnMessage,
    isTerminalError: boolean
  ) => {
    if (!activeLocalRegeneration) return false

    const transaction = activeLocalRegeneration
    activeLocalRegeneration = null

    if (isTerminalError && isEmptyAssistantMessage(message)) {
      adapters.updateMessages(() => transaction.visibleSnapshot)
      return true
    }

    const nextMessages = [...transaction.retainedMessages, message]
    try {
      await (adapters.writeMessages ?? cacheMessages)(
        transaction.chatId,
        nextMessages
      )
    } catch (error) {
      adapters.reportError(
        "Failed to persist regenerated assistant message:",
        error
      )
    }
    return true
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

    if (
      await finishActiveLocalRegeneration(
        message,
        isAbort || isDisconnect || isError
      )
    ) {
      return
    }

    if (isAbort || isDisconnect || isError) {
      if (await rollbackActiveLocalEdit()) return

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

      if (routePersists) {
        try {
          await reconcileRecentMessages(effectiveChatId, 2)
        } catch (error) {
          adapters.reportError("Message ID reconciliation failed: ", error)
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
            await rollbackActiveLocalEdit()
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
          await rollbackActiveLocalEdit()
          adapters.reportError("Failed to persist assistant message:", error)
          return
        }
      }
    }

    activeLocalEdit = null

    try {
      if (!effectiveChatId) return
      await reconcileRecentMessages(effectiveChatId, 2)
    } catch (error) {
      adapters.reportError("Message ID reconciliation failed: ", error)
    }
  }

  return {
    routePersistsMessages,
    persistTurnMessage,
    prepareEditPersistence,
    stageRegeneration,
    rollbackActiveLocalRegeneration,
    finishTurn,
    stagePendingEdit: adapters.pendingEdit.stage,
  }
}

export type ChatTurnStore = ReturnType<typeof createChatTurnStore>
