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
  isNewChatSurface: boolean
  navigateToChat: (chatId: string) => void
  selectedModelOverride: string | null
  setSelectedModelOverride: (modelId: string) => void
  clearSelectedModelOverride: (expectedModelId: string) => void
}

const ChatSessionContext = createContext<ChatSessionContextValue>({
  chatId: null,
  isNewChatSurface: false,
  navigateToChat: () => undefined,
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
  const pathnameChatId = useMemo(() => {
    if (!pathname?.startsWith("/c/")) return null
    const segments = pathname.split("/").filter(Boolean)
    return segments[0] === "c" ? (segments[1] ?? null) : null
  }, [pathname])

  const [shallowHandoff, setShallowHandoff] = useState<{
    fromPathname: string
    targetPathname: string
    chatId: string
  } | null>(null)
  const isHandoffPending = Boolean(
    shallowHandoff &&
      shallowHandoff.fromPathname === pathname &&
      typeof window !== "undefined" &&
      window.location.pathname === shallowHandoff.targetPathname
  )
  const handoffChatId = isHandoffPending
    ? (shallowHandoff?.chatId ?? null)
    : null

  // Once Next observes the pushed pathname (or navigation goes elsewhere),
  // the canonical path owns identity again. Reset during render so consumers
  // never receive a stale handoff for a later Back/Forward transition.
  if (shallowHandoff && !isHandoffPending) {
    setShallowHandoff(null)
  }

  const chatId = pathnameChatId ?? handoffChatId
  const isNewChatSurface = pathname === "/" && chatId === null

  // First-turn navigation deliberately preserves the mounted chat surface.
  // Keep that shallow handoff beside the pathname parser so every consumer
  // observes one route identity through this provider instead of mixing
  // `useParams`, `usePathname`, and direct History API calls.
  const navigateToChat = useCallback(
    (nextChatId: string) => {
      const targetPathname = `/c/${nextChatId}`
      window.history.pushState(null, "", targetPathname)
      setShallowHandoff({
        fromPathname: pathname,
        targetPathname,
        chatId: nextChatId,
      })
    },
    [pathname]
  )

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
      isNewChatSurface,
      navigateToChat,
      selectedModelOverride,
      setSelectedModelOverride,
      clearSelectedModelOverride,
    }),
    [
      chatId,
      isNewChatSurface,
      navigateToChat,
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
