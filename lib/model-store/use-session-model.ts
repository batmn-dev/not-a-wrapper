import { toast } from "@/components/ui/toast"
import { useChatSession } from "@/lib/chat-store/session/provider"
import { Chats } from "@/lib/chat-store/types"
import { useModel as useModelProvider } from "@/lib/model-store/provider"
import { resolvePreferredModelId } from "@/lib/model-store/utils"
import { resolveModelId } from "@/lib/models/model-id-migration"
import type { UserProfile } from "@/lib/user/types"
import { useCallback } from "react"

type UseSessionModelProps = {
  currentChat: Chats | null
  user: UserProfile | null
  updateChatModel?: (chatId: string, model: string) => Promise<void>
  chatId: string | null
  isChatLoading?: boolean
}

/**
 * Hook to manage the current selected model with proper fallback logic
 * Handles both cases: with existing chat (persists to DB) and without chat (local state only)
 * @param currentChat - The current chat object
 * @param user - The current user object
 * @param updateChatModel - Function to update chat model in the database
 * @param chatId - The current chat ID
 * @returns Object containing selected model and handler function
 */
export function useSessionModel({
  currentChat,
  user,
  updateChatModel,
  chatId,
  isChatLoading = false,
}: UseSessionModelProps) {
  const {
    models,
    favoriteModels,
    lastUsedModel,
    modelPrefsHydrated,
    setLastUsedModel,
  } = useModelProvider()
  const {
    selectedModelOverride,
    setSelectedModelOverride,
    clearSelectedModelOverride,
  } = useChatSession()

  // Calculate the effective model based on priority: chat model > accessible
  // last used > accessible favorite > tier default.
  const getEffectiveModel = useCallback(() => {
    const hydratedLastUsedModel = modelPrefsHydrated ? lastUsedModel : null
    const firstFavoriteModel = modelPrefsHydrated ? favoriteModels[0] : null
    return resolvePreferredModelId({
      models,
      isAuthenticated: !!user?.id,
      currentModelId: currentChat?.model,
      preferredModelIds: [hydratedLastUsedModel, firstFavoriteModel],
    })
  }, [
    currentChat?.model,
    favoriteModels,
    lastUsedModel,
    modelPrefsHydrated,
    models,
    user?.id,
  ])

  // Header and Turn context share this session-owned override. It remains the
  // current route's source of truth while persistence catches up.
  const selectedModel = selectedModelOverride || getEffectiveModel()

  // Function to handle model changes with proper validation and error handling
  const handleModelChange = useCallback(
    async (newModel: string) => {
      if (isChatLoading) return

      // Persist as the user's last-used model (survives new chats and sessions)
      setLastUsedModel(newModel)
      setSelectedModelOverride(newModel)

      // For an active chat, let the chat provider choose local cache vs Convex.
      if (chatId && updateChatModel) {
        try {
          await updateChatModel(chatId, newModel)
        } catch (err) {
          // Roll back only this failed selection. A newer selection may already
          // be in flight and must remain authoritative.
          clearSelectedModelOverride(newModel)
          console.error("Failed to update chat model:", err)
          toast({
            title: "Failed to update chat model",
            status: "error",
          })
        }
      }
    },
    [
      chatId,
      clearSelectedModelOverride,
      isChatLoading,
      setLastUsedModel,
      setSelectedModelOverride,
      updateChatModel,
    ]
  )

  return {
    selectedModel,
    handleModelChange,
  }
}
