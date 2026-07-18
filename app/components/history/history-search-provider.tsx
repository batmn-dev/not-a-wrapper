"use client"

import { useKeyShortcut } from "@/app/hooks/use-key-shortcut"
import { useBreakpoint } from "@/hooks/use-breakpoint"
import { useChats } from "@/lib/chat-store/chats/provider"
import { useMessages } from "@/lib/chat-store/messages/provider"
import { useChatSession } from "@/lib/chat-store/session/provider"
import { useUser } from "@/lib/user-store/provider"
import { useRouter } from "next/navigation"
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { DesktopSearchModal } from "./desktop-search-modal"
import { DrawerHistory } from "./drawer-history"
import { useHistoryView } from "./use-history-view"

type HistorySearchContextValue = {
  openHistory: () => void
  closeHistory: () => void
  toggleHistory: () => void
  isHistoryOpen: boolean
}

const HistorySearchContext = createContext<HistorySearchContextValue | null>(
  null
)

export function HistorySearchProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const isMobile = useBreakpoint(768)
  const router = useRouter()
  const { updateTitle, deleteChat } = useChats()
  const { resetMessages } = useMessages()
  const { chatId } = useChatSession()
  const { user } = useUser()
  const isAuthenticated = !!user

  // The history surface reads its own data (server search + paginated browse),
  // not useChats().chats, so it reaches the full history once the sidebar is
  // bounded. See docs/adr/0005-bounded-chat-list-window.md.
  const history = useHistoryView(isOpen)

  const openHistory = useCallback(() => setIsOpen(true), [])
  const closeHistory = useCallback(() => setIsOpen(false), [])
  const toggleHistory = useCallback(
    () => setIsOpen((previous) => !previous),
    []
  )

  useKeyShortcut(
    (event: KeyboardEvent) =>
      (event.key === "k" || event.key === "K") &&
      (event.metaKey || event.ctrlKey),
    toggleHistory
  )

  const handleSaveEdit = useCallback(
    async (id: string, newTitle: string) => {
      await updateTitle(id, newTitle)
    },
    [updateTitle]
  )

  const handleConfirmDelete = useCallback(
    async (id: string) => {
      if (id === chatId) {
        setIsOpen(false)
        await resetMessages()
      }
      await deleteChat(id, chatId || undefined, () => router.push("/"))
    },
    [chatId, resetMessages, deleteChat, router]
  )

  const value = useMemo(
    () => ({
      openHistory,
      closeHistory,
      toggleHistory,
      isHistoryOpen: isOpen,
    }),
    [openHistory, closeHistory, toggleHistory, isOpen]
  )

  return (
    <HistorySearchContext.Provider value={value}>
      {children}
      {isMobile ? (
        <DrawerHistory
          history={history}
          onSaveEdit={handleSaveEdit}
          onConfirmDelete={handleConfirmDelete}
          isOpen={isOpen}
          setIsOpen={setIsOpen}
          isAuthenticated={isAuthenticated}
        />
      ) : (
        <DesktopSearchModal
          history={history}
          currentChatId={chatId}
          isOpen={isOpen}
          onOpenChange={setIsOpen}
          isAuthenticated={isAuthenticated}
        />
      )}
    </HistorySearchContext.Provider>
  )
}

export function useHistorySearch() {
  const context = useContext(HistorySearchContext)
  if (!context) {
    throw new Error(
      "useHistorySearch must be used within HistorySearchProvider"
    )
  }
  return context
}
