import type {
  ChatTurnController,
  ChatTurnMessage,
  EditTurnResult,
} from "@/app/components/chat/chat-turn"
import { useCallback } from "react"

type UseChatEditProps = {
  chatTurn: ChatTurnController
  chatId: string | null
  messages: ChatTurnMessage[]
  /**
   * Live readers for the generation-active guard. Reading `status` /
   * `isSubmitting` from refs at call time (instead of closing over their values)
   * prevents an edit from being wrongly refused with "Please wait until the
   * current message finishes sending." when a stale `submitEdit` closure —
   * held by a memoized message — still sees an old "streaming" status.
   *
   * Model, system prompt, and search enablement are read the same call-time
   * way, by the runner itself through the Turn context snapshot
   * (adapters.getTurnSnapshot) — they are not props here.
   */
  getStatus: () => string
  getIsSubmitting: () => boolean
}

export function useChatEdit({
  chatTurn,
  chatId,
  messages,
  getStatus,
  getIsSubmitting,
}: UseChatEditProps) {
  const submitEdit = useCallback(
    async (messageId: string, newContent: string): Promise<EditTurnResult> => {
      return await chatTurn.runEditTurn({
        chatId,
        messages,
        messageId,
        newContent,
        isSubmitting: getIsSubmitting(),
        status: getStatus(),
      })
    },
    [chatTurn, chatId, messages, getStatus, getIsSubmitting]
  )

  return { submitEdit }
}
