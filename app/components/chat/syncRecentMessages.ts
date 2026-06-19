import { syncRecentMessagesFromStore } from "@/lib/chat-store/turns/chat-turn-service"
import type { UIMessage } from "ai"

// Extended UIMessage type for app compatibility (includes createdAt)
type ExtendedUIMessage = UIMessage & { createdAt?: Date }

export async function syncRecentMessages(
  chatId: string,
  setMessages: (
    updater: (prev: ExtendedUIMessage[]) => ExtendedUIMessage[]
  ) => void,
  count: number = 2
): Promise<void> {
  await syncRecentMessagesFromStore({
    chatId,
    count,
    updateMessages: (updater) => {
      setMessages((prev) => updater(prev))
    },
  })
}
