"use client"

import { AuthModal } from "@/app/auth/_components/auth-modal"
import { ModelSelector } from "@/components/common/model-selector/base"
import { useChats } from "@/lib/chat-store/chats/provider"
import { useChat } from "@/lib/chat-store/chats/use-chat"
import { useChatSession } from "@/lib/chat-store/session/provider"
import { resolvePreferredModelId } from "@/lib/model-store/utils"
import { useModel } from "@/lib/model-store/provider"
import { useUser } from "@/lib/user-store/provider"
import { useCallback, useMemo, useState } from "react"

/**
 * Header-level model selector.
 * Shows the current chat's persisted model when inside a thread, or the user's
 * last-used model on the home/new-chat page. Changing the model persists to both
 * the chat record and localStorage.
 */
export function ModelSelectorHeader() {
  const { models, lastUsedModel, setLastUsedModel, favoriteModels } = useModel()
  const { user } = useUser()
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false)

  const { chatId } = useChatSession()
  const { updateChatModel } = useChats()

  // Resolves out-of-window chats via the chats.getById fallback (useChat).
  const { chat: currentChat } = useChat(chatId)

  const isAuthenticated = !!user?.id

  const effectiveModel = useMemo(
    () =>
      resolvePreferredModelId({
        models,
        isAuthenticated,
        currentModelId: currentChat?.model,
        preferredModelIds: [
          lastUsedModel,
          favoriteModels[0],
        ],
      }),
    [currentChat?.model, favoriteModels, isAuthenticated, lastUsedModel, models]
  )

  const handleSingleModelChange = useCallback(
    (modelId: string) => {
      setLastUsedModel(modelId)

      if (chatId && user?.id) {
        updateChatModel(chatId, modelId).catch((err) =>
          console.error("Failed to update chat model:", err)
        )
      }
    },
    [setLastUsedModel, chatId, user?.id, updateChatModel]
  )

  return (
    <>
      <ModelSelector
        selectedModelId={effectiveModel}
        setSelectedModelId={handleSingleModelChange}
        isUserAuthenticated={isAuthenticated}
        onLockedGuestModelSelect={() => setIsAuthModalOpen(true)}
      />
      <AuthModal
        open={isAuthModalOpen}
        onOpenChange={setIsAuthModalOpen}
        title="Log in to unlock models"
        description="Create an account to use more models and connect your own API keys. GPT-5 Mini stays available for signed-out chats."
      />
    </>
  )
}
