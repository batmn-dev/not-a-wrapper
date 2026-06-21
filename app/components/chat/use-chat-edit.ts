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
  selectedModel: string
  isAuthenticated: boolean
  systemPrompt: string
  enableSearch: boolean
  /**
   * Live readers for the generation-active guard. Reading `status` /
   * `isSubmitting` from refs at call time (instead of closing over their values)
   * prevents an edit from being wrongly refused with "Please wait until the
   * current message finishes sending." when a stale `submitEdit` closure —
   * held by a memoized message — still sees an old "streaming" status.
   */
  getStatus: () => string
  getIsSubmitting: () => boolean
}

export function useChatEdit({
  chatTurn,
  chatId,
  messages,
  selectedModel,
  isAuthenticated,
  systemPrompt,
  enableSearch,
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
        selectedModel,
        isAuthenticated,
        systemPrompt,
        enableSearch,
        isSubmitting: getIsSubmitting(),
        status: getStatus(),
      })
    },
    [
      chatTurn,
      chatId,
      messages,
      selectedModel,
      isAuthenticated,
      systemPrompt,
      enableSearch,
      getStatus,
      getIsSubmitting,
    ]
  )

  return { submitEdit }
}
