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
   * Read at call time because memoized rows may retain this callback while turn
   * state changes. Fresh messages carry the server timestamp required by the
   * edit cutoff; model/search inputs come from the Turn snapshot.
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
