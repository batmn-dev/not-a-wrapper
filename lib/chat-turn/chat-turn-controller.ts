import { convertAttachmentsToFiles } from "@/lib/ai/message-conversion"
import {
  createOptimisticEditMessageId,
  createOptimisticMessageId,
} from "@/lib/chat-store/identity"
import type { Attachment } from "@/lib/file-handling"
import type { ModelReasoningEffort } from "@/lib/models/types"
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
) => void | Promise<void>

/** Read at execution time so every turn kind uses the current picker context. */
export type ChatTurnSnapshot = {
  selectedModel: string
  isAuthenticated: boolean
  systemPrompt: string
  enableSearch: boolean
  /** Per-turn effort (ADR-0026); undefined = Default. Regeneration and edit
   * inherit it exactly like the model — the composer's current value wins. */
  reasoningEffort?: ModelReasoningEffort
}

export type EnsureChatForTurnArgs = {
  userId: string
  text: string
  /** The turn's optimistic message id — persisted as the durable row's
   * clientMessageId by an atomic first-turn creation, so the generation's
   * idempotent write claims that row instead of duplicating it. */
  clientMessageId: string
  /** Complete staged-attachment set the turn is dispatching. */
  attachmentIds: string[]
}

/**
 * The chat a turn runs in. `firstTurn` is present when the chat holds an
 * atomically committed, not-yet-dispatched first turn (chats.createWithFirstTurn)
 * — either created by this call or re-presented by a same-payload retry. The
 * send runner then skips its own binding call, adopts `clientMessageId` as the
 * dispatched message id (so the generation's idempotent write claims the
 * persisted row instead of duplicating it — on a retry this is the ORIGINAL
 * committed id, not the one the runner just allocated), and derives the
 * selected-path token from the server fact — one visible message whose tail is
 * `userMessageId` — instead of its (empty) rendered array.
 */
export type EnsuredTurnChat = {
  chatId: string
  firstTurn?: {
    userMessageId: string
    clientMessageId: string
    attachments: UploadedAttachment[]
    /** Called by the send runner once the dispatch is accepted. The provider
     * then stops re-presenting the committed identity, so a LATER identical
     * payload becomes a genuine new message instead of a claim. */
    confirmDispatched?: () => void
  }
}

export type ChatTurnAdapters = {
  /** Clock seam for deterministic turn-lifecycle tests; production defaults
   * to the browser clock and reads it exactly once per optimistic send. */
  now?: () => Date
  createOptimisticMessageId?: () => string
  createOptimisticEditMessageId?: () => string
  getTurnSnapshot: () => ChatTurnSnapshot
  /** Route identity at turn start. A null route means first-turn creation is
   * still part of this submission, so a pre-dispatch Stop must be consumed
   * before starting the transport. */
  getCurrentChatId: () => string | null
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
  ensureChatExists: (
    args: EnsureChatForTurnArgs
  ) => Promise<EnsuredTurnChat | null>
  setPreviousChatId: (chatId: string) => void
  cleanupOptimisticAttachments: (attachments?: Array<{ url?: string }>) => void
  attachStagedFiles: (
    chatId: string,
    attachmentIds: string[]
  ) => Promise<UploadedAttachment[] | null>
  sendMessage: SendMessage
  /** Dispatches the same SDK message but resolves at HTTP response acceptance,
   * after the server has prepared/claimed the turn and before stream
   * consumption completes. */
  sendMessageAndWaitForAcceptance: SendMessage
  regenerate: (options?: RegenerateMessageOptions) => void | Promise<void>
  /** Event-owned local dispatch boundary for presentation identity/grace. */
  onLocalDispatch?: () => void
  /** Clears any Stop fact left by an earlier completed submission. */
  resetLocalStopIntent?: () => void
  /**
   * Consumes the one-shot fact that the user explicitly stopped the current
   * local dispatch. This distinguishes an intentional transport abort from a
   * navigation, watchdog, timeout, or network failure without inspecting
   * browser-specific error shapes.
   */
  consumeLocalStopIntent?: () => boolean
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
  const startedWithoutChat = adapters.getCurrentChatId() === null

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

  // Reject an incomplete staged set before presenting a turn. An atomic first
  // turn must never commit a chat around references it cannot bind, and the
  // Composer should keep ownership of a payload that was never admissible.
  const attachmentIds = submittedAttachments.flatMap((attachment) =>
    attachment.attachmentId ? [attachment.attachmentId] : []
  )
  if (attachmentIds.length !== submittedAttachments.length) {
    adapters.toastError(errorMessage)
    return
  }

  adapters.setIsSending(true)
  adapters.resetLocalStopIntent?.()
  adapters.setIsSubmitting(true)
  // Nullable until the insert lands: everything fallible after the guards flip
  // runs inside the try below, so a synchronous failure can never strand
  // isSending/isSubmitting armed — and the finally-rollback stays a no-op when
  // no row was ever inserted.
  let optimisticId: string | null = null
  let keepOptimistic = false
  let finalizeAcceptedTurn: (() => void) | null = null

  const removeOptimistic = () => {
    const id = optimisticId
    if (id === null) return
    adapters.setMessages((prev) => prev.filter((message) => message.id !== id))
  }

  try {
    const insertedId = (
      adapters.createOptimisticMessageId ?? createOptimisticMessageId
    )()
    let optimisticMessage: ChatTurnMessage & { role: "user" } = {
      id: insertedId,
      role: "user",
      createdAt: (adapters.now ?? (() => new Date()))(),
      parts: [
        { type: "text", text },
        ...(convertAttachmentsToFiles(optimisticAttachments) ?? []),
      ],
    }

    // The visible turn is an event-owned fact, not a persistence receipt.
    // Insert it in the same React batch as isSubmitting so the user row,
    // pending assistant, and Stop control paint without waiting for rate-limit
    // I/O, chat creation, routing, attachment binding, or transport acceptance.
    const initialOptimisticMessage = optimisticMessage
    adapters.setMessages((prev) => [...prev, initialOptimisticMessage])
    optimisticId = insertedId

    const reconcileOptimistic = (
      nextId: string,
      attachments: UploadedAttachment[]
    ) => {
      const previousId = optimisticMessage.id
      if (
        previousId === nextId &&
        attachments.length === 0 &&
        optimisticAttachments.length === 0
      ) {
        return
      }
      optimisticId = nextId
      optimisticMessage = {
        ...optimisticMessage,
        id: nextId,
        parts: [
          { type: "text", text },
          ...(convertAttachmentsToFiles(attachments) ?? []),
        ],
      }
      const reconciledMessage = optimisticMessage
      adapters.setMessages((prev) =>
        prev.map((message) =>
          message.id === previousId ? reconciledMessage : message
        )
      )
    }

    const userId = await adapters.resolveUserId()
    if (!userId) {
      adapters.toastError("Could not start your session. Please try again.")
      return
    }

    const allowed = await adapters.checkLimitsAndNotify(userId)
    if (!allowed) {
      return
    }

    const ensured = await adapters.ensureChatExists({
      userId,
      text,
      clientMessageId: optimisticId,
      attachmentIds,
    })
    if (!ensured) {
      return
    }
    const currentChatId = ensured.chatId

    // Dispatch under the committed row's identity. On a fresh commit this is
    // the id allocated above; on a same-payload retry it is the ORIGINAL
    // committed id, so the claim selects the persisted row instead of
    // appending a duplicate.
    const admittedOptimisticId =
      ensured.firstTurn?.clientMessageId ?? optimisticId

    adapters.setPreviousChatId(currentChatId)

    // A first turn's attachments were bound atomically with the chat; every
    // later turn binds its staged set to the existing chat here.
    let attachments: UploadedAttachment[] | null =
      ensured.firstTurn?.attachments ?? []
    if (!ensured.firstTurn && attachmentIds.length > 0) {
      attachments = await adapters.attachStagedFiles(
        currentChatId,
        attachmentIds
      )
      if (attachments === null || attachments.length !== attachmentIds.length) {
        adapters.toastError(errorMessage)
        return
      }
    }

    // The immediate frame can use staged preview URLs. Once admission has
    // resolved, update that same row with the durable first-turn identity and
    // canonical bound attachment URLs without changing its createdAt.
    reconcileOptimistic(admittedOptimisticId, attachments)

    const dispatchedMessage = {
      ...optimisticMessage,
    } satisfies ChatTurnMessage

    finalizeAcceptedTurn = () => {
      // An explicit user Stop accepts the submitted turn even when aborting
      // the response races the HTTP-acceptance signal. Consume a first-turn
      // identity too: a later identical prompt is a genuine new turn, not an
      // accidental retry of the intentionally stopped one.
      //
      // Idempotent: the acceptance path and the Stop-consuming catch path can
      // both reach here in one turn; only the first pass may persist and fire
      // callbacks. keepOptimistic doubles as the ran-once fact.
      if (keepOptimistic) return
      keepOptimistic = true
      try {
        ensured.firstTurn?.confirmDispatched?.()
      } catch (error) {
        adapters.reportError(
          "Failed to consume accepted first-turn identity:",
          error
        )
      }
      try {
        adapters.setHasSentFirstMessage(true)
      } catch (error) {
        adapters.reportError(
          "Failed to record accepted first-message state:",
          error
        )
      }
      try {
        const persistence = adapters.turnStore.persistTurnMessage(
          dispatchedMessage,
          currentChatId
        )
        void Promise.resolve(persistence).catch((error) => {
          adapters.reportError(
            "Failed to persist accepted user message:",
            error
          )
        })
      } catch (error) {
        adapters.reportError("Failed to persist accepted user message:", error)
      }
      // An accepted, dispatched turn must never surface as a send failure
      // because post-acceptance bookkeeping (e.g. a sidebar bump) threw.
      try {
        onSuccess?.(currentChatId)
      } catch (error) {
        adapters.reportError("Accepted-turn onSuccess callback failed:", error)
      }
    }

    // Home/project first turns can spend time creating their chat before an
    // SDK request exists. Stop during that window records a one-shot command;
    // consume it here, after the user turn has a durable/local identity but
    // before transport dispatch. The submitted user message remains accepted,
    // while no generation request (and therefore no unowned worker) starts.
    if (
      startedWithoutChat &&
      adapters.consumeLocalStopIntent?.() === true
    ) {
      finalizeAcceptedTurn()
      return
    }

    adapters.onLocalDispatch?.()
    await adapters.sendMessageAndWaitForAcceptance(
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
          reasoningEffort: snapshot.reasoningEffort,
          chatVersion,
          // After an atomic first-turn creation the server's selected path
          // already holds exactly the persisted user message, so the token
          // states that server fact; deriving it from the client's rendered
          // array (still empty) would falsely reject the turn as stale.
          selectedPathToken: ensured.firstTurn
            ? {
                expectedVisibleMessageCount: 1,
                tailMessageId: ensured.firstTurn.userMessageId,
              }
            : buildSelectedPathToken(messages),
        }),
      }
    )

    // The HTTP response is accepted only after the server's durable prepare
    // has claimed the idempotent first-message row. A pre-response failure —
    // including an ambiguous network loss after the server committed — throws
    // above and retains the original identity for a safe same-id retry.
    finalizeAcceptedTurn()
  } catch {
    if (
      finalizeAcceptedTurn !== null &&
      adapters.consumeLocalStopIntent?.() === true
    ) {
      finalizeAcceptedTurn()
      return
    }
    adapters.toastError(errorMessage)
  } finally {
    if (!keepOptimistic) {
      removeOptimistic()
    }
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

    // Edits never allocate: the durable-chat guard above proved chatId names
    // an existing durable chat, so there is no first-turn creation here.
    const currentChatId = chatId

    adapters.setPreviousChatId(currentChatId)

    adapters.setMessages(editPlan.trimmedMessages)

    // Preserve one identity across the optimistic row, SDK replacement, and
    // persisted branch so projection can reconcile without losing live metadata.
    adapters.onLocalDispatch?.()
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
          reasoningEffort: snapshot.reasoningEffort,
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
    adapters.onLocalDispatch?.()
    await adapters.regenerate({
      messageId: regenerationPlan.regeneration.targetAssistantMessageId,
      body: buildChatTurnRequestBody({
        chatId,
        userId,
        selectedModel: snapshot.selectedModel,
        systemPrompt: snapshot.systemPrompt,
        enableSearch: snapshot.enableSearch,
        reasoningEffort: snapshot.reasoningEffort,
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
