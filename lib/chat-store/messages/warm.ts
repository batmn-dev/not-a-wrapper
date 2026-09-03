"use client"

import { api } from "@/convex/_generated/api"
import { useWarmPerUserQuery } from "@/lib/convex/query-cache"
import { useUser } from "@/lib/user-store/provider"
import { useCallback } from "react"
import { getMessagePersistenceMode } from "../identity"

/**
 * Warms the selected-conversation pair — `getSelectedPath` and
 * `getSelectedRunState` with the exact args `MessagesProvider` subscribes
 * with — for a chat the user is about to open, so the route commit finds
 * both delivered instead of loading. Persistence is a property of the caller
 * (ADR-0033): a guest's chats live in IndexedDB and have no server read to
 * warm.
 */
export function useWarmSelectedConversation(): (chatId: string) => void {
  const warm = useWarmPerUserQuery()
  const { user } = useUser()
  const isAuthenticated = Boolean(user?.id)
  return useCallback(
    (chatId: string) => {
      if (getMessagePersistenceMode(isAuthenticated) !== "server") return
      const args = { chatId }
      warm(api.messages.getSelectedPath, args)
      warm(api.messages.getSelectedRunState, args)
    },
    [isAuthenticated, warm]
  )
}
