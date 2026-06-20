import { toast } from "@/components/ui/toast"
import { Chats } from "@/lib/chat-store/types"
import { useModel as useModelProvider } from "@/lib/model-store/provider"
import { resolvePreferredModelId } from "@/lib/model-store/utils"
import { resolveModelId } from "@/lib/models/model-id-migration"
import type { UserProfile } from "@/lib/user/types"
import { useCallback, useState } from "react"

type UseModelProps = {
  currentChat: Chats | null
  user: UserProfile | null
  updateChatModel?: (chatId: string, model: string) => Promise<void>
  chatId: string | null
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
export function useModel({
  currentChat,
  user,
  updateChatModel,
  chatId,
}: UseModelProps) {
  // Get favorite models and last-used model from ModelProvider
  const {
    models,
    favoriteModels,
    lastUsedModel,
    modelPrefsHydrated,
    setLastUsedModel,
  } = useModelProvider()

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

  // Use local state only for temporary overrides, derive base value from props
  const [localSelectedModel, setLocalSelectedModel] = useState<string | null>(
    null
  )

  // Clear local override on chat navigation to prevent model bleed between chats.
  // Tracks previous chatId as state (React 19 recommended pattern for adjusting
  // state when a prop changes — avoids both useEffect cascading renders and
  // ref access during render, both flagged by the React Compiler).
  const [prevChatId, setPrevChatId] = useState(chatId)
  if (prevChatId !== chatId) {
    setPrevChatId(chatId)
    setLocalSelectedModel(null)
  }

  // The actual selected model: local override or computed effective model
  const selectedModel = localSelectedModel || getEffectiveModel()

  // Function to handle model changes with proper validation and error handling
  const handleModelChange = useCallback(
    async (newModel: string) => {
      // Persist as the user's last-used model (survives new chats and sessions)
      setLastUsedModel(newModel)

      // For authenticated users without a chat, we can't persist yet
      // but we still allow the model selection for when they create a chat
      if (!user?.id && !chatId) {
        // For unauthenticated users without chat, just update local state
        setLocalSelectedModel(newModel)
        return
      }

      // For an active chat, let the chat provider choose local cache vs Convex.
      if (chatId && updateChatModel) {
        // Optimistically update the state
        setLocalSelectedModel(newModel)

        try {
          await updateChatModel(chatId, newModel)
          // Clear local override since it's now persisted in the chat
          setLocalSelectedModel(null)
        } catch (err) {
          // Revert on error
          setLocalSelectedModel(null)
          console.error("Failed to update chat model:", err)
          toast({
            title: "Failed to update chat model",
            status: "error",
          })
          throw err
        }
      } else if (user?.id) {
        // Authenticated user but no chat yet - just update local state
        // The model will be used when creating a new chat
        setLocalSelectedModel(newModel)
      }
    },
    [chatId, updateChatModel, user?.id, setLastUsedModel]
  )

  return {
    selectedModel,
    handleModelChange,
  }
}
