import { convertAttachmentsToFiles } from "@/lib/ai/message-conversion"
import {
  createOptimisticEditMessageId,
  createOptimisticMessageId,
} from "@/lib/chat-store/identity"
import {
  buildEditIntent,
  buildChatTurnRequestBody,
  buildSelectedPathToken,
  prepareEditTurnPlan,
  prepareRegenerationTurnPlan,
  routePersistsChatMessages,
  type ChatTurnMessage,
  type ChatTurnStore,
  type SendFilePart,
} from "@/lib/chat-store/turns/chat-turn-service"
import { MESSAGE_MAX_LENGTH } from "@/lib/config"

export type { ChatTurnMessage } from "@/lib/chat-store/turns/chat-turn-service"

const MESSAGE_TOO_LONG_ERROR = `The message you submitted was too long, please submit something shorter. (Max ${MESSAGE_MAX_LENGTH} characters)`

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
type RegenerateMessageOptions = SendMessageOptions & { messageId?: string }

type SendMessage = (
  message: {
    text: string
    files?: SendFilePart[]
  },
  options?: SendMessageOptions
) => void

/**
 * The Turn context snapshot every turn runner reads AT RUN TIME through
 * `adapters.getTurnSnapshot` — never from arguments captured in a render-time
 * closure. This is what keeps the model in the picker and the model in the
 * request structurally identical, and what gives suggestion/regeneration
 * turns the same systemPrompt/enableSearch inputs as plain sends (they
 * previously diverged silently). See CONTEXT.md "Turn context".
 */
export type ChatTurnSnapshot = {
  selectedModel: string
  isAuthenticated: boolean
  systemPrompt: string
  enableSearch: boolean
}

export type ChatTurnAdapters = {
  createOptimisticMessageId?: () => string
  createOptimisticEditMessageId?: () => string
  getTurnSnapshot: () => ChatTurnSnapshot
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
  handleFileUploads: (
    chatId: string,
    files: File[]
  ) => Promise<UploadedAttachment[] | null>
  sendMessage: SendMessage
  regenerate: (options?: RegenerateMessageOptions) => void | Promise<void>
  toastError: (title: string) => void
  bumpChat: (chatId: string) => void
  setLastFinishReason: (finishReason: string | undefined) => void
  reportError: (message: string, error: unknown) => void
}

export type SendTurnArgs = {
  text: string
  messages?: ChatTurnMessage[]
  submittedFiles?: File[]
  optimisticAttachments?: OptimisticAttachment[]
  bodyExtras?: Record<string, unknown>
  onSuccess?: (chatId: string) => void
  errorMessage?: string
}

export type SuggestionTurnArgs = {
  text: string
  messages?: ChatTurnMessage[]
  chatVersion: number
}

export type EditTurnArgs = {
  chatId: string | null
  messages: ChatTurnMessage[]
  messageId: string
  newContent: string
  isSubmitting: boolean
  status: string
}

export type EditTurnFailureReason =
  | "generation-active"
  | "empty-content"
  | "missing-chat"
  | "not-durable"
  | "message-not-found"
  | "missing-message-timestamp"
  | "message-too-long"
  | "auth-required"
  | "limit-denied"
  | "chat-create-failed"
  | "plan-rejected"
  | "dispatch-failed"

export type EditTurnResult =
  | { ok: true }
  | {
      ok: false
      reason: EditTurnFailureReason
      message: string
    }

export type RegenerationTurnArgs = {
  chatId: string | null
  messages: ChatTurnMessage[]
  targetAssistantMessageId: string
  chatVersion: number
  isSubmitting: boolean
  status: string
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

function isGenerationActive({
  isSubmitting,
  status,
}: {
  isSubmitting: boolean
  status: string
}) {
  return isSubmitting || status === "submitted" || status === "streaming"
}

export async function runSendTurn(
  adapters: ChatTurnAdapters,
  {
    text,
    messages = [],
    submittedFiles = [],
    optimisticAttachments = [],
    bodyExtras = {},
    onSuccess,
    errorMessage = "Failed to send message",
  }: SendTurnArgs
) {
  if (adapters.getIsSending()) return

  // Validate the payload before ANY side effect. This guard once lived after
  // ensureChatExists, so a rejected new-chat send had already created, titled
  // (from the rejected text), and navigated to an empty orphan chat. A
  // rejected turn must leave no trace: no chat, no navigation, no optimistic
  // bubble — the Composer restores the payload and the user fixes it in place.
  if (text.length > MESSAGE_MAX_LENGTH) {
    adapters.toastError(MESSAGE_TOO_LONG_ERROR)
    return
  }

  adapters.setIsSending(true)
  adapters.setIsSubmitting(true)

  // Read the Turn context at run time — never from a render-time closure.
  const snapshot = adapters.getTurnSnapshot()

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
    if (!userId) {
      // Same cleanup as every other rejected path: drop the optimistic bubble
      // and revoke its blob: URLs — the Composer restores the payload on the
      // rejected turn, so leaving the bubble would show the text twice.
      removeOptimistic()
      return
    }

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

    let attachments: UploadedAttachment[] | null = []
    if (submittedFiles.length > 0) {
      attachments = await adapters.handleFileUploads(
        currentChatId,
        submittedFiles
      )
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
          selectedModel: snapshot.selectedModel,
          isAuthenticated: snapshot.isAuthenticated,
          systemPrompt: snapshot.systemPrompt,
          enableSearch: snapshot.enableSearch,
          selectedPathToken: buildSelectedPathToken(messages),
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
  // Delegates to the send runner, which reads the Turn context snapshot — so
  // suggestions carry the same systemPrompt/enableSearch as typed sends
  // (previously omitted, silently diverging).
  await runSendTurn(adapters, {
    text: args.text,
    messages: args.messages,
    bodyExtras: {
      chatVersion: args.chatVersion,
    },
    errorMessage: "Failed to send suggestion",
  })
}

export async function runEditTurn(
  adapters: ChatTurnAdapters,
  { chatId, messages, messageId, newContent, isSubmitting, status }: EditTurnArgs
): Promise<EditTurnResult> {
  // Read the Turn context at run time — never from a render-time closure.
  const snapshot = adapters.getTurnSnapshot()

  const reject = (
    reason: EditTurnFailureReason,
    message: string
  ): EditTurnResult => ({
    ok: false,
    reason,
    message,
  })

  if (isGenerationActive({ isSubmitting, status })) {
    const message = "Please wait until the current message finishes sending."
    adapters.toastError(message)
    return reject("generation-active", message)
  }

  if (!newContent.trim()) {
    return reject("empty-content", "Please enter a message.")
  }

  if (!chatId) {
    const message = "Missing chat."
    adapters.toastError(message)
    return reject("missing-chat", message)
  }

  // Edit is a server-owned Chat turn: the backend creates the message branch
  // and derives the selected path. It is only available on a durable chat;
  // guest/local chats are send-only. See CONTEXT.md "Chat turn".
  if (!isRouteDurableChat(chatId, snapshot.isAuthenticated)) {
    const message =
      "Editing is available once the chat is saved. Sign in to edit messages."
    adapters.toastError(message)
    return reject("not-durable", message)
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
    const message = "Message not found"
    adapters.toastError(message)
    return reject("message-not-found", message)
  }

  if (!editPlan.ok && editPlan.reason === "missing-message-timestamp") {
    const message = "Unable to locate message timestamp."
    adapters.reportError(message, undefined)
    return reject("missing-message-timestamp", message)
  }

  if (newContent.length > MESSAGE_MAX_LENGTH) {
    adapters.toastError(MESSAGE_TOO_LONG_ERROR)
    return reject("message-too-long", MESSAGE_TOO_LONG_ERROR)
  }

  if (!editPlan.ok) {
    return reject("plan-rejected", "Unable to prepare edit.")
  }

  try {
    // Optimistic frame only — a visual affordance while the request is in
    // flight. The rendered truth is the backend selected path, installed by the
    // selected-path projection seam once the turn settles (use-chat-core). On a
    // server rejection (e.g. the expectedChatVersion guard) that same seam
    // re-projects the last good path, so sliced-out messages do not vanish.
    adapters.setMessages([
      ...editPlan.trimmedMessages,
      editPlan.optimisticEditedMessage,
    ])

    const userId = await adapters.resolveUserId()
    if (!userId) {
      adapters.setMessages(editPlan.originalMessages)
      const message = "Please sign in and try again."
      adapters.toastError(message)
      return reject("auth-required", message)
    }

    const allowed = await adapters.checkLimitsAndNotify(userId)
    if (!allowed) {
      adapters.setMessages(editPlan.originalMessages)
      return reject("limit-denied", "Message limit reached.")
    }

    const currentChatId = await adapters.ensureChatExists(userId, newContent)
    if (!currentChatId) {
      adapters.setMessages(editPlan.originalMessages)
      return reject("chat-create-failed", "Unable to open chat.")
    }

    adapters.setPreviousChatId(currentChatId)

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
          selectedModel: snapshot.selectedModel,
          isAuthenticated: snapshot.isAuthenticated,
          systemPrompt: snapshot.systemPrompt,
          enableSearch: snapshot.enableSearch,
          chatVersion: editPlan.chatVersion,
          edit: buildEditIntent(messageId, editPlan),
        }),
      }
    )

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
    return { ok: true }
  } catch (error) {
    adapters.reportError("Edit failed:", error)
    adapters.setMessages(editPlan.originalMessages)
    const message = "Failed to apply edit"
    adapters.toastError(message)
    return reject("dispatch-failed", message)
  }
}

export async function runRegenerationTurn(
  adapters: ChatTurnAdapters,
  {
    chatId,
    messages,
    targetAssistantMessageId,
    chatVersion,
    isSubmitting,
    status,
  }: RegenerationTurnArgs
) {
  // Read the Turn context at run time — never from a render-time closure.
  const snapshot = adapters.getTurnSnapshot()

  if (isGenerationActive({ isSubmitting, status })) {
    adapters.toastError("Please wait until the current message finishes sending.")
    return
  }

  if (!chatId) {
    adapters.toastError("Missing chat.")
    return
  }

  // Regeneration is a server-owned Chat turn, available only on a durable
  // chat; guest/local chats are send-only. See CONTEXT.md "Chat turn".
  if (!isRouteDurableChat(chatId, snapshot.isAuthenticated)) {
    adapters.toastError("Regenerating is available once the chat is saved.")
    return
  }

  const regenerationPlan = prepareRegenerationTurnPlan(
    messages,
    targetAssistantMessageId
  )

  if (!regenerationPlan.ok) {
    if (regenerationPlan.reason === "message-not-found") {
      adapters.toastError("Message not found")
      return
    }

    adapters.reportError(
      `Unable to prepare regeneration: ${regenerationPlan.reason}`,
      undefined
    )
    return
  }

  const userId = await adapters.resolveUserId()
  if (!userId) return

  try {
    await adapters.regenerate({
      messageId: regenerationPlan.regeneration.targetAssistantMessageId,
      body: buildChatTurnRequestBody({
        chatId,
        userId,
        selectedModel: snapshot.selectedModel,
        isAuthenticated: snapshot.isAuthenticated,
        systemPrompt: snapshot.systemPrompt,
        enableSearch: snapshot.enableSearch,
        chatVersion,
        regeneration: regenerationPlan.regeneration,
      }),
    })
  } catch (error) {
    adapters.reportError("Regeneration failed:", error)
    adapters.toastError("Failed to regenerate response")
  }
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
