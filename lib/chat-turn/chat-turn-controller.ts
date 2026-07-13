import { convertAttachmentsToFiles } from "@/lib/ai/message-conversion"
import {
  createOptimisticEditMessageId,
  createOptimisticMessageId,
} from "@/lib/chat-store/identity"
import type { Attachment } from "@/lib/file-handling"
import { evaluatePromptSize } from "./prompt-size-policy"
import {
  buildChatTurnRequestBody,
  buildEditRequest,
  buildSelectedPathToken,
  prepareEditTurnPlan,
  prepareRegenerationTurnPlan,
  type ChatTurnMessage,
  type SendFilePart,
} from "./turn-plans"
import {
  createChatTurnStore,
  routePersistsChatMessages,
  type ChatTurnStore,
  type ChatTurnStoreAdapters,
} from "./turn-store"

// React-free client turn orchestration behind the adapters seam. It owns
// validation, optimistic frames, dispatch planning, and persistence routing.

export type { ChatTurnMessage } from "./turn-plans"

type SetMessagesAction =
  ChatTurnMessage[] | ((messages: ChatTurnMessage[]) => ChatTurnMessage[])

// The shared attachment shape (lib/file-handling.ts). An optimistic attachment
// is the same minus the server-assigned id it does not have yet.
type OptimisticAttachment = Omit<Attachment, "attachmentId">
type UploadedAttachment = Attachment
export type StagedAttachmentReference = Pick<Attachment, "attachmentId"> &
  Partial<Omit<Attachment, "attachmentId">>

type SendMessageOptions = { body?: Record<string, unknown> }
type RegenerateMessageOptions = SendMessageOptions & { messageId?: string }

type SendMessage = (
  message:
    | {
        text: string
        files?: SendFilePart[]
      }
    // The full-message form: the SDK appends it verbatim (keeping `id`), or
    // atomically replaces the optimistic row when `messageId` is present. Turn
    // runners use this to preserve live identity and top-level `createdAt`.
    | {
        id: string
        role: "user"
        parts: ChatTurnMessage["parts"]
        createdAt?: Date
        messageId?: string
      },
  options?: SendMessageOptions
) => void

/** Read at execution time so every turn kind uses the current picker context. */
export type ChatTurnSnapshot = {
  selectedModel: string
  isAuthenticated: boolean
  systemPrompt: string
  enableSearch: boolean
}

export type ChatTurnAdapters = {
  /** Clock seam for deterministic turn-lifecycle tests; production defaults
   * to the browser clock and reads it exactly once per optimistic send. */
  now?: () => Date
  createOptimisticMessageId?: () => string
  createOptimisticEditMessageId?: () => string
  getTurnSnapshot: () => ChatTurnSnapshot
  getIsSending: () => boolean
  setIsSending: (isSending: boolean) => void
  setIsSubmitting: (isSubmitting: boolean) => void
  setHasSentFirstMessage: (hasSent: boolean) => void
  setMessages: (action: SetMessagesAction) => void
  /** Persistence adapters — the controller composes its turn store from these
   * internally; callers never build or hold the store. */
  store: ChatTurnStoreAdapters
  resolveUserId: () => Promise<string | null>
  checkLimitsAndNotify: (userId: string) => Promise<boolean>
  ensureChatExists: (userId: string, input: string) => Promise<string | null>
  setPreviousChatId: (chatId: string) => void
  cleanupOptimisticAttachments: (attachments?: Array<{ url?: string }>) => void
  attachStagedFiles: (
    chatId: string,
    attachmentIds: string[]
  ) => Promise<UploadedAttachment[] | null>
  sendMessage: SendMessage
  regenerate: (options?: RegenerateMessageOptions) => void | Promise<void>
  toastError: (title: string) => void
  bumpChat: (chatId: string) => void
  setLastFinishReason: (finishReason: string | undefined) => void
  reportError: (message: string, error: unknown) => void
}

/** The runners' view: the adapters plus the internally composed turn store. */
type RunnerContext = Omit<ChatTurnAdapters, "store"> & {
  turnStore: ChatTurnStore
}

export type SendTurnArgs = {
  text: string
  messages?: ChatTurnMessage[]
  submittedFiles?: File[]
  submittedAttachments?: StagedAttachmentReference[]
  optimisticAttachments?: OptimisticAttachment[]
  chatVersion?: number
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
  const turnStore = createChatTurnStore(adapters.store)
  // Read adapters at call time because callers may replace the injected seams.
  const context = (): RunnerContext => {
    const { store: _store, ...runnerAdapters } = adapters
    return { ...runnerAdapters, turnStore }
  }
  return {
    runSendTurn: (args: SendTurnArgs) => runSendTurn(context(), args),
    runSuggestionTurn: (args: SuggestionTurnArgs) =>
      runSuggestionTurn(context(), args),
    runEditTurn: (args: EditTurnArgs) => runEditTurn(context(), args),
    runRegenerationTurn: (args: RegenerationTurnArgs) =>
      runRegenerationTurn(context(), args),
    finishChatTurn: (args: FinishChatTurnArgs) =>
      finishChatTurn(context(), args),
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

async function runSendTurn(
  adapters: RunnerContext,
  {
    text,
    messages = [],
    submittedFiles = [],
    submittedAttachments = [],
    optimisticAttachments = [],
    chatVersion,
    onSuccess,
    errorMessage = "Failed to send message",
  }: SendTurnArgs
) {
  if (adapters.getIsSending()) return

  // Read the Turn context at run time — never from a render-time closure.
  const snapshot = adapters.getTurnSnapshot()

  // Rejected payloads must create no chat, navigation, or optimistic row.
  const promptSize = evaluatePromptSize({
    modelId: snapshot.selectedModel,
    systemPrompt: snapshot.systemPrompt,
    messages,
    nextText: text,
    submittedFiles,
  })
  if (!promptSize.ok) {
    if (optimisticAttachments.length > 0) {
      adapters.cleanupOptimisticAttachments(optimisticAttachments)
    }
    adapters.toastError(promptSize.message)
    return
  }

  adapters.setIsSending(true)
  adapters.setIsSubmitting(true)
  let optimisticId: string | null = null
  let optimisticMessage: (ChatTurnMessage & { role: "user" }) | null = null

  const removeOptimistic = () => {
    if (!optimisticId) return
    const id = optimisticId
    adapters.setMessages((prev) => prev.filter((message) => message.id !== id))
  }

  try {
    const userId = await adapters.resolveUserId()
    if (!userId) {
      return
    }

    const allowed = await adapters.checkLimitsAndNotify(userId)
    if (!allowed) {
      return
    }

    const currentChatId = await adapters.ensureChatExists(userId, text)
    if (!currentChatId) {
      return
    }

    adapters.setPreviousChatId(currentChatId)

    let attachments: UploadedAttachment[] | null = []
    const attachmentIds = submittedAttachments.flatMap((attachment) =>
      attachment.attachmentId ? [attachment.attachmentId] : []
    )
    if (attachmentIds.length !== submittedAttachments.length) {
      adapters.toastError(errorMessage)
      return
    }
    if (attachmentIds.length > 0) {
      attachments = await adapters.attachStagedFiles(
        currentChatId,
        attachmentIds
      )
      if (attachments === null || attachments.length !== attachmentIds.length) {
        adapters.toastError(errorMessage)
        return
      }
    }

    optimisticId = (
      adapters.createOptimisticMessageId ?? createOptimisticMessageId
    )()
    optimisticMessage = {
      id: optimisticId,
      role: "user",
      createdAt: (adapters.now ?? (() => new Date()))(),
      parts: [
        { type: "text", text },
        ...(convertAttachmentsToFiles(attachments) ?? []),
      ],
    }
    adapters.setMessages((prev) => [...prev, optimisticMessage!])

    const dispatchedMessage = {
      ...optimisticMessage,
    } satisfies ChatTurnMessage

    adapters.sendMessage(
      {
        ...dispatchedMessage,
        // Replaces the already-rendered optimistic row synchronously inside
        // the AI SDK. Its id and createdAt therefore survive the handoff, so
        // render-derived grouping never appears a frame late.
        messageId: optimisticId,
      },
      {
        body: buildChatTurnRequestBody({
          chatId: currentChatId,
          userId,
          selectedModel: snapshot.selectedModel,
          systemPrompt: snapshot.systemPrompt,
          enableSearch: snapshot.enableSearch,
          chatVersion,
          selectedPathToken: buildSelectedPathToken(messages),
        }),
      }
    )

    adapters.setHasSentFirstMessage(true)
    void adapters.turnStore.persistTurnMessage(dispatchedMessage, currentChatId)
    onSuccess?.(currentChatId)
  } catch {
    removeOptimistic()
    adapters.toastError(errorMessage)
  } finally {
    adapters.setIsSending(false)
    adapters.setIsSubmitting(false)
  }
}

async function runSuggestionTurn(
  adapters: RunnerContext,
  args: SuggestionTurnArgs
) {
  await runSendTurn(adapters, {
    text: args.text,
    messages: args.messages,
    chatVersion: args.chatVersion,
    errorMessage: "Failed to send suggestion",
  })
}

async function runEditTurn(
  adapters: RunnerContext,
  {
    chatId,
    messages,
    messageId,
    newContent,
    isSubmitting,
    status,
  }: EditTurnArgs
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

  if (!editPlan.ok) {
    return reject("plan-rejected", "Unable to prepare edit.")
  }

  const promptSize = evaluatePromptSize({
    modelId: snapshot.selectedModel,
    systemPrompt: snapshot.systemPrompt,
    messages: editPlan.trimmedMessages,
    nextText: newContent,
  })
  if (!promptSize.ok) {
    adapters.toastError(promptSize.message)
    return reject("message-too-long", promptSize.message)
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

    // Preserve one identity across the optimistic row, SDK replacement, and
    // persisted branch so projection can reconcile without losing live metadata.
    adapters.sendMessage(
      {
        id: editPlan.optimisticEditedMessage.id,
        role: "user",
        parts: editPlan.optimisticEditedMessage.parts,
        createdAt: editPlan.optimisticEditedMessage.createdAt,
      },
      {
        body: buildChatTurnRequestBody({
          chatId: currentChatId,
          userId,
          selectedModel: snapshot.selectedModel,
          systemPrompt: snapshot.systemPrompt,
          enableSearch: snapshot.enableSearch,
          chatVersion: editPlan.chatVersion,
          edit: buildEditRequest(messageId, editPlan),
        }),
      }
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

async function runRegenerationTurn(
  adapters: RunnerContext,
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
    adapters.toastError(
      "Please wait until the current message finishes sending."
    )
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

async function finishChatTurn(
  adapters: RunnerContext,
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
