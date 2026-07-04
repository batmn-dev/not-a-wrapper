"use client"

import { usePathname } from "next/navigation"
import { createContext, useContext, useMemo } from "react"

const ChatSessionContext = createContext<{ chatId: string | null }>({
  chatId: null,
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

  return (
    <ChatSessionContext.Provider value={{ chatId }}>
      {children}
    </ChatSessionContext.Provider>
  )
}
