"use client"

import { AuthModal } from "@/app/auth/_components/auth-modal"
import { ModelSelector } from "@/components/common/model-selector/base"
import { useChats } from "@/lib/chat-store/chats/provider"
import { useChat } from "@/lib/chat-store/chats/use-chat"
import { useChatSession } from "@/lib/chat-store/session/provider"
import { useSessionModel } from "@/lib/model-store/use-session-model"
import { useUser } from "@/lib/user-store/provider"
import { useState } from "react"

/**
 * Header-level model selector.
 * Shows the current chat's persisted model when inside a thread, or the user's
 * last-used model on the home/new-chat page. Changing the model persists to both
 * the chat record and localStorage.
 */
export function ModelSelectorHeader() {
  const { user } = useUser()
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false)

  const { chatId } = useChatSession()
  const { updateChatModel } = useChats()

  // Resolves out-of-window chats via the chats.getById fallback (useChat).
  const { chat: currentChat, isLoading: isChatLoading } = useChat(chatId)
  const isResolvingCurrentChat = !!chatId && isChatLoading

  const isAuthenticated = !!user?.id
  const { selectedModel, handleModelChange } = useSessionModel({
    currentChat: currentChat ?? null,
    user,
    updateChatModel,
    chatId,
    isChatLoading: isResolvingCurrentChat,
  })

  return (
    <>
      <ModelSelector
        selectedModelId={isResolvingCurrentChat ? null : selectedModel}
        setSelectedModelId={handleModelChange}
        isUserAuthenticated={isAuthenticated}
        disabled={isResolvingCurrentChat}
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
