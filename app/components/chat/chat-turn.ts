import { convertAttachmentsToFiles } from "@/lib/ai/message-conversion"
import {
  createOptimisticEditMessageId,
  createOptimisticMessageId,
  isServerChatId,
} from "@/lib/chat-store/identity"
import { MESSAGE_MAX_LENGTH, SYSTEM_PROMPT_DEFAULT } from "@/lib/config"
import type { UIMessage } from "@ai-sdk/react"

export type ChatTurnMessage = UIMessage & { createdAt?: Date }

type SetMessagesAction =
  | ChatTurnMessage[]
  | ((messages: ChatTurnMessage[]) => ChatTurnMessage[])

type OptimisticAttachment = {
  name: string
  contentType: string
  url: string
}

type UploadedAttachment = {
  name: string
  contentType: string
  url: string
  attachmentId?: string
}

type SendFilePart = {
  type: "file"
  filename: string
  mediaType: string
  url: string
  attachmentId?: string
}

type SendMessageOptions = { body?: Record<string, unknown> }

type SendMessage = (
  message: {
    text: string
    files?: SendFilePart[]
  },
  options?: SendMessageOptions
) => void

type PendingEdit = {
  message: ChatTurnMessage
  chatId: string
}

export type ChatTurnAdapters = {
  createOptimisticMessageId?: () => string
  createOptimisticEditMessageId?: () => string
  getIsSending: () => boolean
  setIsSending: (isSending: boolean) => void
  setIsSubmitting: (isSubmitting: boolean) => void
  setHasSentFirstMessage: (hasSent: boolean) => void
  setMessages: (action: SetMessagesAction) => void
  resolveUserId: () => Promise<string | null>
  checkLimitsAndNotify: (userId: string) => Promise<boolean>
  ensureChatExists: (userId: string, input: string) => Promise<string | null>
  setPreviousChatId: (chatId: string) => void
  cleanupOptimisticAttachments: (attachments?: Array<{ url?: string }>) => void
  handleFileUploads: (chatId: string) => Promise<UploadedAttachment[] | null>
  sendMessage: SendMessage
  regenerate: (options?: SendMessageOptions) => void
  routePersistsMessages: (chatId: string) => boolean
  cacheAndAddMessage: (
    message: ChatTurnMessage,
    overrideChatId?: string
  ) => void | Promise<void>
  toastError: (title: string) => void
  writeTrimmedMessages: (
    chatId: string,
    messages: ChatTurnMessage[]
  ) => void | Promise<void>
  deleteMessagesFromTimestamp: (
    timestamp: number,
    minVersion?: number
  ) => Promise<void>
  updateTitle: (chatId: string, title: string) => void | Promise<void>
  stagePendingEdit: (message: ChatTurnMessage, chatId: string) => void
  getPendingEdit: () => PendingEdit | null
  clearPendingEdit: () => void
  bumpChat: (chatId: string) => void
  setLastFinishReason: (finishReason: string | undefined) => void
  getStoredGuestChatId: () => string | null
  reconcileRecentMessages: (chatId: string, count: number) => Promise<void>
  reportError: (message: string, error: unknown) => void
}

export type SendTurnArgs = {
  text: string
  selectedModel: string
  isAuthenticated: boolean
  submittedFiles?: File[]
  optimisticAttachments?: OptimisticAttachment[]
  bodyExtras?: Record<string, unknown>
  onSuccess?: (chatId: string) => void
  errorMessage?: string
}

export type SuggestionTurnArgs = {
  text: string
  selectedModel: string
  isAuthenticated: boolean
  chatVersion: number
}

export type EditTurnArgs = {
  chatId: string | null
  messages: ChatTurnMessage[]
  messageId: string
  newContent: string
  selectedModel: string
  isAuthenticated: boolean
  systemPrompt: string
  enableSearch: boolean
  isSubmitting: boolean
  status: string
}

export type RegenerationTurnArgs = {
  chatId: string | null
  selectedModel: string
  isAuthenticated: boolean
  systemPrompt: string
  chatVersion: number
}

export type FinishChatTurnArgs = {
  message: ChatTurnMessage
  isAbort: boolean
  isDisconnect: boolean
  isError: boolean
  finishReason?: string
  chatId: string | null
  previousChatId: string | null
}

export function isRouteDurableChat(
  chatId: string | null,
  isAuthenticated: boolean
) {
  return Boolean(isAuthenticated && isServerChatId(chatId))
}

export function createChatTurnController(adapters: ChatTurnAdapters) {
  return {
    runSendTurn: (args: SendTurnArgs) => runSendTurn(adapters, args),
    runSuggestionTurn: (args: SuggestionTurnArgs) =>
      runSuggestionTurn(adapters, args),
    runEditTurn: (args: EditTurnArgs) => runEditTurn(adapters, args),
    runRegenerationTurn: (args: RegenerationTurnArgs) =>
      runRegenerationTurn(adapters, args),
    finishChatTurn: (args: FinishChatTurnArgs) =>
      finishChatTurn(adapters, args),
  }
}

export type ChatTurnController = ReturnType<typeof createChatTurnController>

export async function runSendTurn(
  adapters: ChatTurnAdapters,
  {
    text,
    selectedModel,
    isAuthenticated,
    submittedFiles = [],
    optimisticAttachments = [],
    bodyExtras = {},
    onSuccess,
    errorMessage = "Failed to send message",
  }: SendTurnArgs
) {
  if (adapters.getIsSending()) return
  adapters.setIsSending(true)
  adapters.setIsSubmitting(true)

  const optimisticId = (
    adapters.createOptimisticMessageId ?? createOptimisticMessageId
  )()
  const optimisticMessage: ChatTurnMessage = {
    id: optimisticId,
    role: "user",
    createdAt: new Date(),
    parts: [
      { type: "text", text },
      ...optimisticAttachments.map((attachment) => ({
        type: "file" as const,
        filename: attachment.name,
        mediaType: attachment.contentType,
        url: attachment.url,
      })),
    ],
  }

  adapters.setMessages((prev) => [...prev, optimisticMessage])

  const getFileUrlsFromParts = () =>
    optimisticMessage.parts
      ?.filter((part) => part.type === "file")
      .map((part) => ({ url: (part as { url?: string }).url })) || []

  const removeOptimistic = () => {
    adapters.setMessages((prev) =>
      prev.filter((message) => message.id !== optimisticId)
    )
    adapters.cleanupOptimisticAttachments(getFileUrlsFromParts())
  }

  try {
    const userId = await adapters.resolveUserId()
    if (!userId) return

    const allowed = await adapters.checkLimitsAndNotify(userId)
    if (!allowed) {
      removeOptimistic()
      return
    }

    const currentChatId = await adapters.ensureChatExists(userId, text)
    if (!currentChatId) {
      removeOptimistic()
      return
    }

    adapters.setPreviousChatId(currentChatId)

    if (text.length > MESSAGE_MAX_LENGTH) {
      adapters.toastError(
        `The message you submitted was too long, please submit something shorter. (Max ${MESSAGE_MAX_LENGTH} characters)`
      )
      removeOptimistic()
      return
    }

    let attachments: UploadedAttachment[] | null = []
    if (submittedFiles.length > 0) {
      attachments = await adapters.handleFileUploads(currentChatId)
      if (attachments === null) {
        removeOptimistic()
        return
      }
    }

    adapters.sendMessage(
      {
        text,
        files: attachments?.length
          ? convertAttachmentsToFiles(attachments)
          : undefined,
      },
      {
        body: {
          chatId: currentChatId,
          userId,
          model: selectedModel,
          isAuthenticated,
          systemPrompt: SYSTEM_PROMPT_DEFAULT,
          ...bodyExtras,
        },
      }
    )

    adapters.setHasSentFirstMessage(true)
    removeOptimistic()
    if (!adapters.routePersistsMessages(currentChatId)) {
      adapters.cacheAndAddMessage(optimisticMessage, currentChatId)
    }
    onSuccess?.(currentChatId)
  } catch {
    removeOptimistic()
    adapters.toastError(errorMessage)
  } finally {
    adapters.setIsSending(false)
    adapters.setIsSubmitting(false)
  }
}

export async function runSuggestionTurn(
  adapters: ChatTurnAdapters,
  args: SuggestionTurnArgs
) {
  await runSendTurn(adapters, {
    text: args.text,
    selectedModel: args.selectedModel,
    isAuthenticated: args.isAuthenticated,
    bodyExtras: {
      chatVersion: args.chatVersion,
    },
    errorMessage: "Failed to send suggestion",
  })
}

export async function runEditTurn(
  adapters: ChatTurnAdapters,
  {
    chatId,
    messages,
    messageId,
    newContent,
    selectedModel,
    isAuthenticated,
    systemPrompt,
    enableSearch,
    isSubmitting,
    status,
  }: EditTurnArgs
) {
  if (isSubmitting || status === "submitted" || status === "streaming") {
    adapters.toastError("Please wait until the current message finishes sending.")
    return
  }

  if (!newContent.trim()) return

  if (!chatId) {
    adapters.toastError("Missing chat.")
    return
  }

  const editIndex = messages.findIndex(
    (message) => String(message.id) === String(messageId)
  )
  if (editIndex === -1) {
    adapters.toastError("Message not found")
    return
  }

  const target = messages[editIndex]
  const cutoffTimestamp = target?.createdAt?.getTime()
  if (!cutoffTimestamp) {
    adapters.reportError("Unable to locate message timestamp.", undefined)
    return
  }

  if (newContent.length > MESSAGE_MAX_LENGTH) {
    adapters.toastError(
      `The message you submitted was too long, please submit something shorter. (Max ${MESSAGE_MAX_LENGTH} characters)`
    )
    return
  }

  const originalMessages = [...messages]
  const optimisticId = (
    adapters.createOptimisticEditMessageId ?? createOptimisticEditMessageId
  )()
  const targetFileParts =
    target.parts?.filter((part) => part.type === "file") || []
  const optimisticEditedMessage: ChatTurnMessage = {
    id: optimisticId,
    role: "user",
    createdAt: new Date(),
    parts: [{ type: "text", text: newContent }, ...targetFileParts],
  }

  try {
    const trimmedMessages = messages.slice(0, editIndex)
    adapters.setMessages([...trimmedMessages, optimisticEditedMessage])

    const userId = await adapters.resolveUserId()
    if (!userId) {
      adapters.setMessages(originalMessages)
      adapters.toastError("Please sign in and try again.")
      return
    }

    const allowed = await adapters.checkLimitsAndNotify(userId)
    if (!allowed) {
      adapters.setMessages(originalMessages)
      return
    }

    const currentChatId = await adapters.ensureChatExists(userId, newContent)
    if (!currentChatId) {
      adapters.setMessages(originalMessages)
      return
    }

    adapters.setPreviousChatId(currentChatId)

    try {
      await adapters.writeTrimmedMessages(chatId, trimmedMessages)
    } catch {}

    await adapters.deleteMessagesFromTimestamp(
      cutoffTimestamp,
      trimmedMessages.length + 1
    )

    if (editIndex === 0 && target.role === "user") {
      try {
        await adapters.updateTitle(currentChatId, newContent)
      } catch {}
    }

    adapters.setMessages(trimmedMessages)

    const targetFiles = targetFileParts.map((part) => ({
      type: "file" as const,
      filename: (part as { filename?: string }).filename || "file",
      mediaType:
        (part as { mediaType?: string }).mediaType ||
        "application/octet-stream",
      url: (part as { url?: string }).url || "",
    }))

    adapters.sendMessage(
      {
        text: newContent,
        files: targetFiles.length > 0 ? targetFiles : undefined,
      },
      {
        body: {
          chatId: currentChatId,
          userId,
          model: selectedModel,
          isAuthenticated,
          systemPrompt: systemPrompt || SYSTEM_PROMPT_DEFAULT,
          enableSearch,
          chatVersion: trimmedMessages.length + 1,
        },
      }
    )

    adapters.setMessages((prev) =>
      prev.filter((message) => message.id !== optimisticId)
    )
    adapters.stagePendingEdit(optimisticEditedMessage, currentChatId)
    adapters.bumpChat(currentChatId)
  } catch (error) {
    adapters.reportError("Edit failed:", error)
    adapters.setMessages(originalMessages)
    adapters.toastError("Failed to apply edit")
  }
}

export async function runRegenerationTurn(
  adapters: ChatTurnAdapters,
  {
    chatId,
    selectedModel,
    isAuthenticated,
    systemPrompt,
    chatVersion,
  }: RegenerationTurnArgs
) {
  const userId = await adapters.resolveUserId()
  if (!userId) return

  adapters.regenerate({
    body: {
      chatId,
      userId,
      model: selectedModel,
      isAuthenticated,
      systemPrompt: systemPrompt || SYSTEM_PROMPT_DEFAULT,
      chatVersion,
    },
  })
}

export async function finishChatTurn(
  adapters: ChatTurnAdapters,
  {
    message,
    isAbort,
    isDisconnect,
    isError,
    finishReason,
    chatId,
    previousChatId,
  }: FinishChatTurnArgs
) {
  adapters.setLastFinishReason(finishReason)

  if (isAbort || isDisconnect || isError) {
    const pendingEdit = adapters.getPendingEdit()
    if (pendingEdit) {
      adapters.clearPendingEdit()
      if (adapters.routePersistsMessages(pendingEdit.chatId)) {
        return
      }
      try {
        await adapters.cacheAndAddMessage(pendingEdit.message, pendingEdit.chatId)
      } catch (error) {
        adapters.stagePendingEdit(pendingEdit.message, pendingEdit.chatId)
        adapters.reportError(
          "Failed to persist pending edited message on abort/error:",
          error
        )
      }
    }
    return
  }

  const effectiveChatId =
    chatId || previousChatId || adapters.getStoredGuestChatId()

  if (effectiveChatId) {
    const routePersistsMessages = adapters.routePersistsMessages(effectiveChatId)
    const pendingEdit = adapters.getPendingEdit()

    if (pendingEdit) {
      adapters.clearPendingEdit()
      if (!routePersistsMessages) {
        await adapters.cacheAndAddMessage(pendingEdit.message, pendingEdit.chatId)
      }
    }

    if (!routePersistsMessages) {
      await adapters.cacheAndAddMessage(message, effectiveChatId)
    }
  }

  try {
    if (!effectiveChatId) return
    await adapters.reconcileRecentMessages(effectiveChatId, 2)
  } catch (error) {
    adapters.reportError("Message ID reconciliation failed: ", error)
  }
}
