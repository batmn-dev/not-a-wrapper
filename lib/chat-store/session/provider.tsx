"use client"

import { usePathname } from "next/navigation"
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react"

type ChatSessionContextValue = {
  chatId: string | null
  selectedModelOverride: string | null
  setSelectedModelOverride: (modelId: string) => void
  clearSelectedModelOverride: (expectedModelId: string) => void
}

const ChatSessionContext = createContext<ChatSessionContextValue>({
  chatId: null,
  selectedModelOverride: null,
  setSelectedModelOverride: () => undefined,
  clearSelectedModelOverride: () => undefined,
})

export const useChatSession = () => useContext(ChatSessionContext)

export function ChatSessionProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const chatId = useMemo(() => {
    if (!pathname?.startsWith("/c/")) return null
    const segments = pathname.split("/").filter(Boolean)
    return segments[0] === "c" ? (segments[1] ?? null) : null
  }, [pathname])

  const [modelSelection, setModelSelection] = useState<{
    chatId: string | null
    modelId: string | null
  }>({ chatId, modelId: null })

  // Route identity owns the override lifetime. Adjusting this provider's own
  // state during render avoids an effect-only stale commit without remounting
  // the app subtree that sits below this session provider.
  if (modelSelection.chatId !== chatId) {
    setModelSelection({ chatId, modelId: null })
  }

  const selectedModelOverride =
    modelSelection.chatId === chatId ? modelSelection.modelId : null

  const setSelectedModelOverride = useCallback(
    (modelId: string) => {
      setModelSelection({ chatId, modelId })
    },
    [chatId]
  )

  const clearSelectedModelOverride = useCallback(
    (expectedModelId: string) => {
      setModelSelection((current) => {
        if (current.chatId !== chatId || current.modelId !== expectedModelId) {
          return current
        }
        return { chatId, modelId: null }
      })
    },
    [chatId]
  )

  const value = useMemo<ChatSessionContextValue>(
    () => ({
      chatId,
      selectedModelOverride,
      setSelectedModelOverride,
      clearSelectedModelOverride,
    }),
    [
      chatId,
      selectedModelOverride,
      setSelectedModelOverride,
      clearSelectedModelOverride,
    ]
  )

  return (
    <ChatSessionContext.Provider value={value}>
      {children}
    </ChatSessionContext.Provider>
  )
}
