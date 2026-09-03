import { toast } from "@/components/ui/toast"
import { checkRateLimits } from "@/lib/api"
import type {
  CreateFirstTurnChatInput,
  FirstTurnChatResult,
} from "@/lib/chat-store/chats/provider"
import {
  createChatPublicId,
  GUEST_CHAT_STORAGE_KEY,
} from "@/lib/chat-store/identity"
import type {
  EnsureChatForTurnArgs,
  EnsuredTurnChat,
} from "@/lib/chat-turn/chat-turn-controller"
import { REMAINING_QUERY_ALERT_THRESHOLD } from "@/lib/config"
import type { Attachment } from "@/lib/file-handling"
import { useEffect, useRef } from "react"

/**
 * The first turn's allocation (ADR-0031). The chat id is minted and committed
 * to the session BEFORE creation; `committed` flips once the local or atomic
 * durable creation has landed. `committedTurn` (durable creations only)
 * retains the atomically persisted turn's full identity so a same-payload
 * retry re-presents it — the dispatch then claims the persisted row
 * idempotently instead of racing the projection (a `{count: 0}` stale
 * rejection) or appending a duplicate prompt.
 */
type FirstTurnAllocation = {
  chatId: string
  committed: boolean
  committedTurn?: {
    userMessageId: string
    clientMessageId: string
    text: string
    attachmentIds: string[]
    attachments: Attachment[]
  }
}

function isSameAttachmentSet(committed: string[], requested: string[]) {
  if (committed.length !== requested.length) return false
  const sortedRequested = [...requested].sort()
  return [...committed]
    .sort()
    .every((id, index) => id === sortedRequested[index])
}

type UseChatOperationsProps = {
  isAuthenticated: boolean
  chatId: string | null
  selectedModel: string
  systemPrompt: string
  /** When set, first-turn chats are created inside this project. */
  projectId?: string
  createFirstTurnChat: (
    input: CreateFirstTurnChatInput
  ) => Promise<FirstTurnChatResult>
  /** Session identity commands (the only History API owner). */
  commitChatIdentity: (chatId: string) => void
  resetChatIdentity: () => void
  setHasDialogAuth: (value: boolean) => void
  /** Identity seam for tests; production mints a UUID. */
  createChatId?: () => string
}

export function useChatOperations({
  isAuthenticated,
  chatId,
  selectedModel,
  systemPrompt,
  projectId,
  createFirstTurnChat,
  commitChatIdentity,
  resetChatIdentity,
  setHasDialogAuth,
  createChatId = createChatPublicId,
}: UseChatOperationsProps) {
  // The allocation bridges the identity commit → chatId-prop lag inside one
  // first turn, and survives a post-commit dispatch failure so a retry reuses
  // the chat. Returning to the no-chat surface (Back/Forward to onboarding,
  // which does NOT remount the mounted Chat, or a rollback) must invalidate
  // it, or the next first turn would silently append to the previous chat.
  const allocationRef = useRef<FirstTurnAllocation | null>(null)
  const previousChatIdRef = useRef(chatId)
  useEffect(() => {
    const previousChatId = previousChatIdRef.current
    previousChatIdRef.current = chatId
    if (previousChatId !== null && chatId === null) {
      allocationRef.current = null
    }
  }, [chatId])

  /**
   * Mint the first turn's identity and commit its route synchronously, before
   * the optimistic row paints and before any request leaves. Idempotent
   * within one first turn: a retry that still holds an allocation reuses it.
   */
  const beginFirstTurn = (): string => {
    const current = allocationRef.current
    if (current) return current.chatId
    const nextChatId = createChatId()
    allocationRef.current = { chatId: nextChatId, committed: false }
    commitChatIdentity(nextChatId)
    return nextChatId
  }

  /**
   * The one pre-commit rollback: identity cleared (origin route restored)
   * and the allocation dropped. Never called once creation has landed — a
   * later dispatch failure keeps the chat at its route (ADR-0012).
   */
  const rollbackFirstTurn = () => {
    const current = allocationRef.current
    if (!current || current.committed) return
    allocationRef.current = null
    resetChatIdentity()
  }

  // Acceptance consumes the committed identity: the persisted first-turn row
  // may be claimed by exactly one dispatch, so once one is accepted the
  // allocation keeps only the chatId (the commit → prop lag bridge).
  const confirmFirstTurnDispatched = (dispatchedChatId: string) => {
    const current = allocationRef.current
    if (current?.chatId === dispatchedChatId && current.committedTurn) {
      allocationRef.current = { chatId: current.chatId, committed: true }
    }
  }

  const checkLimitsAndNotify = async (uid: string): Promise<boolean> => {
    try {
      const rateData = await checkRateLimits(uid, isAuthenticated)

      if (rateData.remaining === 0 && !isAuthenticated) {
        setHasDialogAuth(true)
        return false
      }

      if (rateData.remaining === REMAINING_QUERY_ALERT_THRESHOLD) {
        toast({
          title: `Only ${rateData.remaining} quer${
            rateData.remaining === 1 ? "y" : "ies"
          } remaining today.`,
          status: "info",
        })
      }

      return true
    } catch (err) {
      console.error("Rate limit check failed:", err)
      return false
    }
  }

  const createAllocatedChat = async (
    allocation: FirstTurnAllocation,
    { userId, text, clientMessageId, attachmentIds }: EnsureChatForTurnArgs
  ): Promise<EnsuredTurnChat | null> => {
    const createWithId = (publicId: string) =>
      createFirstTurnChat({
        publicId,
        model: selectedModel,
        systemPrompt,
        ...(projectId ? { projectId } : {}),
        ...(isAuthenticated ? {} : { guestUserId: userId }),
        message: { clientMessageId, text },
        attachmentIds,
      })

    let activeChatId = allocation.chatId
    let created = await createWithId(activeChatId)

    // Another holder of the minted id (typed server conflict): re-mint
    // exactly once, re-committing the route in place, then retry.
    if (created?.kind === "conflict") {
      activeChatId = createChatId()
      allocationRef.current = { chatId: activeChatId, committed: false }
      commitChatIdentity(activeChatId)
      created = await createWithId(activeChatId)
    }

    if (!created || created.kind === "conflict") return null
    if (created.kind === "local") {
      allocationRef.current = { chatId: activeChatId, committed: true }
      localStorage.setItem(GUEST_CHAT_STORAGE_KEY, activeChatId)
      return { chatId: activeChatId }
    }

    allocationRef.current = {
      chatId: activeChatId,
      committed: true,
      committedTurn: {
        userMessageId: created.userMessageId,
        clientMessageId,
        text,
        attachmentIds,
        attachments: created.attachments,
      },
    }
    return {
      chatId: activeChatId,
      firstTurn: {
        userMessageId: created.userMessageId,
        clientMessageId,
        attachments: created.attachments,
        confirmDispatched: () => confirmFirstTurnDispatched(activeChatId),
      },
    }
  }

  const ensureChatExists = async (
    args: EnsureChatForTurnArgs
  ): Promise<EnsuredTurnChat | null> => {
    const { text, attachmentIds } = args
    const allocation = allocationRef.current
    const committed = allocation?.committedTurn

    // Same-payload retry of a committed-but-not-yet-dispatched first turn:
    // re-present the committed identity so the dispatch claims the persisted
    // row instead of duplicating it. Once a dispatch is accepted,
    // confirmDispatched drops the committed turn, so a later identical payload
    // becomes a normal new message.
    if (
      allocation &&
      committed &&
      (chatId === null || chatId === allocation.chatId) &&
      committed.text === text &&
      isSameAttachmentSet(committed.attachmentIds, attachmentIds)
    ) {
      return {
        chatId: allocation.chatId,
        firstTurn: {
          userMessageId: committed.userMessageId,
          clientMessageId: committed.clientMessageId,
          attachments: committed.attachments,
          confirmDispatched: () => confirmFirstTurnDispatched(allocation.chatId),
        },
      }
    }

    // The identity was committed at Send (beginFirstTurn); creation lands
    // here, after the pre-creation refusals. The chatId prop may already
    // carry the committed id, so the allocation is consulted first.
    if (allocation && !allocation.committed) {
      try {
        return await createAllocatedChat(allocation, args)
      } catch (err: unknown) {
        let errorMessage = "Something went wrong."
        try {
          const errorObj = err as { message?: string }
          if (errorObj.message) {
            const parsed = JSON.parse(errorObj.message)
            errorMessage = parsed.error || errorMessage
          }
        } catch {
          const errorObj = err as { message?: string }
          errorMessage = errorObj.message || errorMessage
        }
        toast({ title: errorMessage, status: "error" })
        return null
      }
    }

    if (chatId) return { chatId }
    // A different payload while the prop lags appends to the allocated chat as
    // a normal turn.
    if (allocation) return { chatId: allocation.chatId }

    // No identity was committed for this send (the surface returned to
    // onboarding mid-flight): refuse rather than mint outside Send.
    return null
  }

  return {
    checkLimitsAndNotify,
    ensureChatExists,
    beginFirstTurn,
    rollbackFirstTurn,
  }
}
