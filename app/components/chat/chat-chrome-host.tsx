"use client"

import { Header } from "@/app/components/layout/header"
import { useUserPreferences } from "@/lib/user-preference-store/provider"
import { createContext, useContext, useMemo, useState } from "react"

/**
 * Host side of the chat chrome contract (ADR-0017, amended).
 *
 * The chrome DECISION belongs to Chat (resolveChatChrome — chat-chrome.ts): it
 * flips with client state inside shallow route handoffs. The header's DOM
 * POSITION belongs to the shell: it must precede the `<main id="main">`
 * landmark so the skip-to-content link actually bypasses it and `<header>`
 * keeps its implicit banner role — nesting it inside main forfeits both
 * (the a11y regression this split exists to prevent; ChatGPT's live DOM uses
 * the same skip-link + header-before-main structure).
 *
 * Chat publishes the resolved appHeader fact pre-paint, and the shell's
 * header slot renders it. `initialAppHeader` mirrors the route's SSR-known
 * first surface so server HTML and hydration agree: /p/ always mounts as
 * project onboarding (false); / and /c/ always mount with the header (true).
 */
const ChatChromeContext = createContext<{
  appHeader: boolean
  setAppHeader: (appHeader: boolean) => void
} | null>(null)

export function ChatChromeProvider({
  initialAppHeader,
  children,
}: {
  initialAppHeader: boolean
  children: React.ReactNode
}) {
  const [appHeader, setAppHeader] = useState(initialAppHeader)
  const value = useMemo(() => ({ appHeader, setAppHeader }), [appHeader])
  return (
    <ChatChromeContext.Provider value={value}>
      {children}
    </ChatChromeContext.Provider>
  )
}

/** Chat-side publisher. Null outside a provider (standalone mounts, tests). */
export function useSetChatChromeAppHeader() {
  return useContext(ChatChromeContext)?.setAppHeader ?? null
}

/**
 * The shell's header-slot filler: chat routes pass this to LayoutApp's
 * pre-<main> `header` slot; visibility follows Chat's published decision.
 */
export function ChatChromeHeader() {
  const context = useContext(ChatChromeContext)
  const { preferences } = useUserPreferences()
  if (!context?.appHeader) return null
  return <Header hasSidebar={preferences.layout === "sidebar"} />
}
