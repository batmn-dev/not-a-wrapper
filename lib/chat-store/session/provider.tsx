"use client"

import { markChatPerfThreadRouteCommitted } from "@/lib/observability/chat-performance-client"
import { usePathname } from "next/navigation"
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"

type ChatSessionContextValue = {
  chatId: string | null
  isNewChatSurface: boolean
  /** The first turn is adopting its client-minted chat id before Next has
   * observed the pushed pathname. */
  isChatIdHandoff: boolean
  /**
   * Send sets the active chat identity; the route follows synchronously
   * (`/c/<chatId>` via pushState) before any request leaves (ADR-0031).
   * Re-committing while a handoff is pending replaces the pushed entry
   * (the one-time re-mint after a server-side id conflict).
   */
  commitChatIdentity: (chatId: string) => void
  /**
   * Pre-commit rollback: clears the identity and restores the origin route
   * with replaceState, so a refused first turn leaves no orphan entry.
   */
  resetChatIdentity: () => void
  selectedModelOverride: string | null
  setSelectedModelOverride: (modelId: string) => void
  clearSelectedModelOverride: (expectedModelId: string) => void
}

const ChatSessionContext = createContext<ChatSessionContextValue>({
  chatId: null,
  isNewChatSurface: false,
  isChatIdHandoff: false,
  commitChatIdentity: () => undefined,
  resetChatIdentity: () => undefined,
  selectedModelOverride: null,
  setSelectedModelOverride: () => undefined,
  clearSelectedModelOverride: () => undefined,
})

export const useChatSession = () => useContext(ChatSessionContext)

type ShallowHandoff = {
  fromPathname: string
  targetPathname: string
  chatId: string
}

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

  const [shallowHandoff, setShallowHandoff] = useState<ShallowHandoff | null>(
    null
  )
  // Latest-value mirrors so the commit/reset commands read the live handoff
  // and pathname at call time: turn runners call them after awaits, from
  // closures older than the render that recorded the handoff.
  const handoffRef = useRef<ShallowHandoff | null>(null)
  const pathnameRef = useRef(pathname)
  useLayoutEffect(() => {
    handoffRef.current = shallowHandoff
    pathnameRef.current = pathname
  }, [shallowHandoff, pathname])

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
  const isChatIdHandoff = isHandoffPending

  // The route is a derived view of session state: this provider is the only
  // History API caller, so every consumer observes one route identity instead
  // of mixing `useParams`, `usePathname`, and direct pushState calls. The
  // shallow commit deliberately preserves the mounted chat surface.
  const commitChatIdentity = useCallback((nextChatId: string) => {
    const targetPathname = `/c/${nextChatId}`
    const current = handoffRef.current
    const pending =
      current &&
      current.fromPathname === pathnameRef.current &&
      window.location.pathname === current.targetPathname
        ? current
        : null
    if (pending) {
      window.history.replaceState(null, "", targetPathname)
    } else {
      window.history.pushState(null, "", targetPathname)
    }
    markChatPerfThreadRouteCommitted()
    const next = {
      fromPathname: pending?.fromPathname ?? pathnameRef.current,
      targetPathname,
      chatId: nextChatId,
    }
    handoffRef.current = next
    setShallowHandoff(next)
  }, [])

  const resetChatIdentity = useCallback(() => {
    const current = handoffRef.current
    if (!current) return
    // Only the pushed entry is replaced; if the user already navigated away
    // (Back mid-send), history is left exactly as they made it.
    if (window.location.pathname === current.targetPathname) {
      window.history.replaceState(null, "", current.fromPathname)
    }
    handoffRef.current = null
    setShallowHandoff(null)
  }, [])

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
      isChatIdHandoff,
      commitChatIdentity,
      resetChatIdentity,
      selectedModelOverride,
      setSelectedModelOverride,
      clearSelectedModelOverride,
    }),
    [
      chatId,
      isNewChatSurface,
      isChatIdHandoff,
      commitChatIdentity,
      resetChatIdentity,
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
