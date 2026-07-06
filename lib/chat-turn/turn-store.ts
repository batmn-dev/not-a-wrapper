import {
  isEmptyAssistantMessage,
  isTerminalOutcomeStub,
} from "@/convex/domain/message_visibility"
import { getMessagePersistenceMode } from "@/lib/chat-store/identity"
import {
  cacheMessages,
  getCachedMessages,
} from "@/lib/chat-store/messages/api"
import type { ChatTurnMessage } from "./turn-plans"

// ---------------------------------------------------------------------------
// Chat turn controller internals — the persistence half: guest/local chats
// cache turn messages in IndexedDB; durable chats are route-persisted and skip
// the local cache entirely. Composed inside createChatTurnController; the
// parent hook supplies only the adapters and never holds the store.
// ---------------------------------------------------------------------------

export type SetChatTurnMessages = (
  updater: (messages: ChatTurnMessage[]) => ChatTurnMessage[]
) => void

export type PendingEdit = {
  message: ChatTurnMessage
  chatId: string
}

export function routePersistsChatMessages(
  chatId: string | null,
  isAuthenticated: boolean
) {
  return Boolean(
    chatId && isAuthenticated && getMessagePersistenceMode(chatId) === "server"
  )
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

  // The SDK's transient empty assistant (no durable status) is removable
  // noise after an abort/error. An empty assistant carrying a terminal
  // failed/aborted status is NOT: it is the durable stub the selected-path
  // projection installs, and removing it here raced the projection — the
  // stub vanished with nothing left to re-trigger its reinstall.
  const isRemovableEmptyAssistantMessage = (candidate: ChatTurnMessage) =>
    isEmptyAssistantMessage(candidate) && !isTerminalOutcomeStub(candidate)

  const removeEmptyAssistantMessages = async (chatId: string) => {
    let removedVisible = false

    adapters.updateMessages((prev) => {
      const next = prev.filter(
        (candidate) => !isRemovableEmptyAssistantMessage(candidate)
      )
      removedVisible = next.length !== prev.length
      return removedVisible ? next : prev
    })

    const readMessages = adapters.readMessages ?? getCachedMessages
    const writeMessages = adapters.writeMessages ?? cacheMessages
    const cachedMessages = await readMessages(chatId)
    const cleanedMessages = cachedMessages.filter(
      (candidate) => !isRemovableEmptyAssistantMessage(candidate)
    )

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
          await removeEmptyAssistantMessages(effectiveChatId)
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
        if (!routePersists) {
          try {
            await adapters.cacheAndAddMessage(
              pendingEdit.message,
              effectiveChatId
            )
          } catch (error) {
            adapters.reportError(
              "Failed to persist pending edited message:",
              error
            )
            return
          }
        }
        adapters.pendingEdit.clear()
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
