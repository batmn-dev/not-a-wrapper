import { convertAttachmentsToFiles } from "@/lib/ai/message-conversion"
import {
  createOptimisticEditMessageId,
  createOptimisticMessageId,
} from "@/lib/chat-store/identity"
import {
  buildEditIntent,
  buildChatTurnRequestBody,
  prepareEditTurnPlan,
  routePersistsChatMessages,
  type ChatTurnMessage,
  type ChatTurnStore,
  type SendFilePart,
} from "@/lib/chat-store/turns/chat-turn-service"
import { MESSAGE_MAX_LENGTH } from "@/lib/config"

export type { ChatTurnMessage } from "@/lib/chat-store/turns/chat-turn-service"

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

type SendMessageOptions = { body?: Record<string, unknown> }

type SendMessage = (
  message: {
    text: string
    files?: SendFilePart[]
  },
  options?: SendMessageOptions
) => void

export type ChatTurnAdapters = {
  createOptimisticMessageId?: () => string
  createOptimisticEditMessageId?: () => string
  getIsSending: () => boolean
  setIsSending: (isSending: boolean) => void
  setIsSubmitting: (isSubmitting: boolean) => void
  setHasSentFirstMessage: (hasSent: boolean) => void
  setMessages: (action: SetMessagesAction) => void
  turnStore: ChatTurnStore
  resolveUserId: () => Promise<string | null>
  checkLimitsAndNotify: (userId: string) => Promise<boolean>
  ensureChatExists: (userId: string, input: string) => Promise<string | null>
  setPreviousChatId: (chatId: string) => void
  cleanupOptimisticAttachments: (attachments?: Array<{ url?: string }>) => void
  handleFileUploads: (chatId: string) => Promise<UploadedAttachment[] | null>
  sendMessage: SendMessage
  regenerate: (options?: SendMessageOptions) => void
  toastError: (title: string) => void
  bumpChat: (chatId: string) => void
  setLastFinishReason: (finishReason: string | undefined) => void
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
  return routePersistsChatMessages(chatId, isAuthenticated)
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
        body: buildChatTurnRequestBody({
          chatId: currentChatId,
          userId,
          selectedModel,
          isAuthenticated,
          bodyExtras,
        }),
      }
    )

    adapters.setHasSentFirstMessage(true)
    removeOptimistic()
    void adapters.turnStore.persistTurnMessage(optimisticMessage, currentChatId)
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
    adapters.toastError(
      "Please wait until the current message finishes sending."
    )
    return
  }

  if (!newContent.trim()) return

  if (!chatId) {
    adapters.toastError("Missing chat.")
    return
  }

  const editPlan = prepareEditTurnPlan({
    messages,
    messageId,
    newContent,
    createOptimisticEditMessageId: () =>
      (
        adapters.createOptimisticEditMessageId ?? createOptimisticEditMessageId
      )(),
  })

  if (!editPlan.ok && editPlan.reason === "message-not-found") {
    adapters.toastError("Message not found")
    return
  }

  if (!editPlan.ok && editPlan.reason === "missing-message-timestamp") {
    adapters.reportError("Unable to locate message timestamp.", undefined)
    return
  }

  if (newContent.length > MESSAGE_MAX_LENGTH) {
    adapters.toastError(
      `The message you submitted was too long, please submit something shorter. (Max ${MESSAGE_MAX_LENGTH} characters)`
    )
    return
  }

  if (!editPlan.ok) return

  let editPersistence:
    | Awaited<ReturnType<ChatTurnStore["prepareEditPersistence"]>>
    | null = null

  try {
    adapters.setMessages([
      ...editPlan.trimmedMessages,
      editPlan.optimisticEditedMessage,
    ])

    const userId = await adapters.resolveUserId()
    if (!userId) {
      adapters.setMessages(editPlan.originalMessages)
      adapters.toastError("Please sign in and try again.")
      return
    }

    const allowed = await adapters.checkLimitsAndNotify(userId)
    if (!allowed) {
      adapters.setMessages(editPlan.originalMessages)
      return
    }

    const currentChatId = await adapters.ensureChatExists(userId, newContent)
    if (!currentChatId) {
      adapters.setMessages(editPlan.originalMessages)
      return
    }

    adapters.setPreviousChatId(currentChatId)

    editPersistence = await adapters.turnStore.prepareEditPersistence({
      sourceChatId: chatId,
      targetChatId: currentChatId,
      plan: editPlan,
    })

    adapters.setMessages(editPlan.trimmedMessages)

    adapters.sendMessage(
      {
        text: newContent,
        files: editPlan.sendFiles.length > 0 ? editPlan.sendFiles : undefined,
      },
      {
        body: buildChatTurnRequestBody({
          chatId: currentChatId,
          userId,
          selectedModel,
          isAuthenticated,
          systemPrompt,
          enableSearch,
          chatVersion: editPlan.chatVersion,
          edit: editPersistence.routePersists
            ? buildEditIntent(messageId, editPlan)
            : undefined,
        }),
      }
    )

    await editPersistence.accept()

    adapters.setMessages((prev) =>
      prev.filter(
        (message) => message.id !== editPlan.optimisticEditedMessage.id
      )
    )
    adapters.turnStore.stagePendingEdit(
      editPlan.optimisticEditedMessage,
      currentChatId
    )
    adapters.bumpChat(currentChatId)
  } catch (error) {
    adapters.reportError("Edit failed:", error)
    try {
      await editPersistence?.rollback()
    } catch (rollbackError) {
      adapters.reportError("Failed to restore edit transaction:", rollbackError)
    }
    adapters.setMessages(editPlan.originalMessages)
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
    body: buildChatTurnRequestBody({
      chatId,
      userId,
      selectedModel,
      isAuthenticated,
      systemPrompt,
      chatVersion,
    }),
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
  await adapters.turnStore.finishTurn({
    message,
    isAbort,
    isDisconnect,
    isError,
    chatId,
    previousChatId,
  })
}
