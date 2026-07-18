import { toast } from "@/components/ui/toast"
import { checkRateLimits } from "@/lib/api"
import type {
  CreateFirstTurnChatInput,
  FirstTurnChat,
} from "@/lib/chat-store/chats/provider"
import { GUEST_CHAT_STORAGE_KEY } from "@/lib/chat-store/identity"
import type {
  EnsureChatForTurnArgs,
  EnsuredTurnChat,
} from "@/lib/chat-turn/chat-turn-controller"
import { REMAINING_QUERY_ALERT_THRESHOLD } from "@/lib/config"
import type { Attachment } from "@/lib/file-handling"
import { useEffect, useRef } from "react"

/**
 * The first turn's allocation, held for the pushState → chatId-prop lag.
 * `committedTurn` (durable creations only) retains the atomically persisted
 * turn's full identity so a same-payload retry re-presents it — the dispatch
 * then claims the persisted row idempotently instead of racing the projection
 * (a `{count: 0}` stale rejection) or appending a duplicate prompt.
 */
type FirstTurnAllocation = {
  chatId: string
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
  ) => Promise<FirstTurnChat | undefined>
  navigateToChat?: (chatId: string) => void
  setHasDialogAuth: (value: boolean) => void
}

export function useChatOperations({
  isAuthenticated,
  chatId,
  selectedModel,
  systemPrompt,
  projectId,
  createFirstTurnChat,
  navigateToChat,
  setHasDialogAuth,
}: UseChatOperationsProps) {
  // A failed first turn may leave the newly allocated route in place. Reuse it
  // on retry instead of creating another chat from the same mounted composer
  // closure. The ref only bridges the pushState → chatId-prop lag inside one
  // first turn: returning to the no-chat surface (Back/Forward to onboarding,
  // which does NOT remount the mounted Chat) must invalidate it, or the next
  // first turn would silently append to the previous chat with the URL still
  // on the onboarding route.
  const allocationRef = useRef<FirstTurnAllocation | null>(null)
  const previousChatIdRef = useRef(chatId)
  useEffect(() => {
    const previousChatId = previousChatIdRef.current
    previousChatIdRef.current = chatId
    if (previousChatId !== null && chatId === null) {
      allocationRef.current = null
    }
  }, [chatId])

  // Acceptance consumes the committed identity: the persisted first-turn row
  // may be claimed by exactly one dispatch, so once one is accepted the
  // allocation keeps only the chatId (the pushState → prop lag bridge).
  const confirmFirstTurnDispatched = (dispatchedChatId: string) => {
    const current = allocationRef.current
    if (current?.chatId === dispatchedChatId && current.committedTurn) {
      allocationRef.current = { chatId: current.chatId }
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

      if (rateData.remainingPro === REMAINING_QUERY_ALERT_THRESHOLD) {
        toast({
          title: `Only ${rateData.remainingPro} pro quer${
            rateData.remainingPro === 1 ? "y" : "ies"
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

  const ensureChatExists = async ({
    userId,
    text,
    clientMessageId,
    attachmentIds,
  }: EnsureChatForTurnArgs): Promise<EnsuredTurnChat | null> => {
    const allocation = allocationRef.current
    const committed = allocation?.committedTurn

    // Same-payload retry of a committed-but-not-yet-dispatched first turn:
    // re-present the committed identity so the dispatch claims the persisted
    // row instead of duplicating it. Checked BEFORE the chatId-prop early
    // return because navigation precedes dispatch — by retry time the prop has
    // usually caught up to the allocated route. Once a dispatch is accepted,
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

    if (chatId) return { chatId }
    // A different payload while the prop lags appends to the allocated chat as
    // a normal turn.
    if (allocation) return { chatId: allocation.chatId }

    try {
      const created = await createFirstTurnChat({
        title: text,
        model: selectedModel,
        systemPrompt,
        ...(projectId ? { projectId } : {}),
        ...(isAuthenticated ? {} : { guestUserId: userId }),
        message: { clientMessageId, text },
        attachmentIds,
      })

      if (!created) return null
      if (created.kind === "local") {
        allocationRef.current = { chatId: created.chat.id }
        localStorage.setItem(GUEST_CHAT_STORAGE_KEY, created.chat.id)
      } else {
        allocationRef.current = {
          chatId: created.chat.id,
          committedTurn: {
            userMessageId: created.userMessageId,
            clientMessageId,
            text,
            attachmentIds,
            attachments: created.attachments,
          },
        }
      }
      // Navigation happens only after the full atomic commit (chat + bound
      // attachments + first user message), so the handed-off route can never
      // hold a permanently empty chat.
      navigateToChat?.(created.chat.id)

      if (created.kind === "local") {
        return { chatId: created.chat.id }
      }
      return {
        chatId: created.chat.id,
        firstTurn: {
          userMessageId: created.userMessageId,
          clientMessageId,
          attachments: created.attachments,
          confirmDispatched: () => confirmFirstTurnDispatched(created.chat.id),
        },
      }
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
      toast({
        title: errorMessage,
        status: "error",
      })
      return null
    }
  }

  return {
    checkLimitsAndNotify,
    ensureChatExists,
  }
}
