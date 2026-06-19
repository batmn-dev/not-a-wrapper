import type {
  ChatTurnController,
  ChatTurnMessage,
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
  isSubmitting: boolean
  status: string
}

export function useChatEdit({
  chatTurn,
  chatId,
  messages,
  selectedModel,
  isAuthenticated,
  systemPrompt,
  enableSearch,
  isSubmitting,
  status,
}: UseChatEditProps) {
  const submitEdit = useCallback(
    async (messageId: string, newContent: string) => {
      await chatTurn.runEditTurn({
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
      isSubmitting,
      status,
    ]
  )

  return { submitEdit }
}
