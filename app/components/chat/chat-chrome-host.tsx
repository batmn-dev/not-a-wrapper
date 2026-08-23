"use client"

import { Header } from "@/app/components/layout/header"
import { useUserPreferences } from "@/lib/user-preference-store/provider"
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react"
import type { ChatChrome } from "./chat-chrome"

type ChatChromeState = Pick<ChatChrome, "appHeader" | "fixedHeader">

/**
 * Host side of the chat chrome contract (ADR-0017, amended).
 *
 * The chrome DECISION belongs to Chat (resolveChatChrome — chat-chrome.ts): it
 * flips with client state inside shallow route handoffs. The header's DOM
 * POSITION belongs to the shell: it must precede the `<main id="main">`
 * landmark so the skip-to-content link actually bypasses it and `<header>`
 * keeps its implicit banner role; nesting it inside main forfeits both.
 *
 * Chat publishes the resolved header facts pre-paint, and the shell's header
 * slot renders them. The initial values mirror the route group's SSR-known
 * first surface so server HTML and hydration agree; Chat publishes the exact
 * thread mode before paint once the client surface resolves.
 */
const ChatChromeContext = createContext<{
  chrome: ChatChromeState
  setChrome: (chrome: ChatChromeState) => void
} | null>(null)

export function ChatChromeProvider({
  initialAppHeader,
  initialFixedHeader,
  children,
}: {
  initialAppHeader: boolean
  initialFixedHeader: ChatChromeState["fixedHeader"]
  children: React.ReactNode
}) {
  const [chrome, setChromeState] = useState<ChatChromeState>({
    appHeader: initialAppHeader,
    fixedHeader: initialFixedHeader,
  })
  const setChrome = useCallback((nextChrome: ChatChromeState) => {
    setChromeState((currentChrome) =>
      currentChrome.appHeader === nextChrome.appHeader &&
      currentChrome.fixedHeader === nextChrome.fixedHeader
        ? currentChrome
        : nextChrome
    )
  }, [])
  const value = useMemo(() => ({ chrome, setChrome }), [chrome, setChrome])
  return (
    <ChatChromeContext.Provider value={value}>
      {children}
    </ChatChromeContext.Provider>
  )
}

/** Chat-side publisher. Null outside a provider (standalone mounts, tests). */
export function useSetChatChrome() {
  return useContext(ChatChromeContext)?.setChrome ?? null
}

/**
 * The shell's header-slot filler: chat routes pass this to LayoutApp's
 * pre-<main> `header` slot; visibility follows Chat's published decision.
 */
export function ChatChromeHeader() {
  const context = useContext(ChatChromeContext)
  const { preferences } = useUserPreferences()
  if (!context?.chrome.appHeader) return null
  return (
    <Header
      hasSidebar={preferences.layout === "sidebar"}
      fixedHeader={context.chrome.fixedHeader}
    />
  )
}
