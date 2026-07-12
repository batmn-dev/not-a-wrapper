import type {
  ChatTurnController,
  ChatTurnMessage,
  EditTurnResult,
} from "@/lib/chat-turn/chat-turn-controller"
import { useCallback } from "react"

type UseChatEditProps = {
  chatTurn: ChatTurnController
  chatId: string | null
  /**
   * Live readers for the edit turn's inputs. Reading `messages`, `status`,
   * and `isSubmitting` from refs at CALL time (instead of closing over their
   * render-time values) is load-bearing: the message row is memoized and its
   * comparator deliberately ignores callback identity, so a stale `submitEdit`
   * closure survives re-renders that only change turn state.
   *
   * - `getStatus` / `getIsSubmitting`: a stale "streaming" status wrongly
   *   refused an edit with "Please wait until the current message finishes
   *   sending."
   * - `getMessages`: a stale array carried the optimistic client-clock
   *   `createdAt` from before the selected-path projection adopted the
   *   server's write-time value, so the server's edit cutoff guard rejected
   *   every same-session edit with "Edited message version changed" until a
   *   reload re-hydrated the row (live-reproduced 2026-07-11).
   *
   * Model, system prompt, and search enablement are read the same call-time
   * way, by the runner itself through the Turn context snapshot
   * (adapters.getTurnSnapshot) — they are not props here.
   */
  getMessages: () => ChatTurnMessage[]
  getStatus: () => string
  getIsSubmitting: () => boolean
}

export function useChatEdit({
  chatTurn,
  chatId,
  getMessages,
  getStatus,
  getIsSubmitting,
}: UseChatEditProps) {
  const submitEdit = useCallback(
    async (messageId: string, newContent: string): Promise<EditTurnResult> => {
      return await chatTurn.runEditTurn({
        chatId,
        messages: getMessages(),
        messageId,
        newContent,
        isSubmitting: getIsSubmitting(),
        status: getStatus(),
      })
    },
    [chatTurn, chatId, getMessages, getStatus, getIsSubmitting]
  )

  return { submitEdit }
}
