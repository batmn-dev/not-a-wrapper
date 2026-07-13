import { toast } from "@/components/ui/toast"
import { checkRateLimits } from "@/lib/api"
import { GUEST_CHAT_STORAGE_KEY } from "@/lib/chat-store/identity"
import type { Chats } from "@/lib/chat-store/types"
import { REMAINING_QUERY_ALERT_THRESHOLD } from "@/lib/config"

type UseChatOperationsProps = {
  isAuthenticated: boolean
  chatId: string | null
  selectedModel: string
  systemPrompt: string
  createNewChat: (
    userId: string,
    title?: string,
    model?: string,
    isAuthenticated?: boolean,
    systemPrompt?: string
  ) => Promise<Chats | undefined>
  navigateToChat?: (chatId: string) => void
  setHasDialogAuth: (value: boolean) => void
  allocatedChatIdRef?: { current: string | null }
}

export function useChatOperations({
  isAuthenticated,
  chatId,
  selectedModel,
  systemPrompt,
  createNewChat,
  navigateToChat,
  setHasDialogAuth,
  allocatedChatIdRef = { current: null },
}: UseChatOperationsProps) {
  // A failed first turn may leave the newly allocated route in place. Reuse it
  // on retry instead of creating another empty chat from the same mounted
  // composer closure.
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

  const ensureChatExists = async (userId: string, input: string) => {
    if (chatId) return chatId
    if (allocatedChatIdRef.current) return allocatedChatIdRef.current

    try {
      const newChat = await createNewChat(
        userId,
        input,
        selectedModel,
        isAuthenticated,
        systemPrompt
      )

      if (!newChat) return null
      allocatedChatIdRef.current = newChat.id
      if (!isAuthenticated) {
        localStorage.setItem(GUEST_CHAT_STORAGE_KEY, newChat.id)
      }
      navigateToChat?.(newChat.id)

      return newChat.id
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
