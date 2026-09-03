"use client"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useWarmPerUserQuery } from "@/lib/convex/query-cache"
import { useCallback } from "react"
import { getMessagePersistenceMode } from "../identity"

/**
 * Warms the selected-conversation pair — `getSelectedPath` and
 * `getSelectedRunState` with the exact args `MessagesProvider` subscribes
 * with — for a chat the user is about to open, so the route commit finds
 * both delivered instead of loading. Guest/local chats have no server read
 * to warm.
 */
export function useWarmSelectedConversation(): (chatId: string) => void {
  const warm = useWarmPerUserQuery()
  return useCallback(
    (chatId: string) => {
      if (getMessagePersistenceMode(chatId) !== "server") return
      const args = { chatId: chatId as Id<"chats"> }
      warm(api.messages.getSelectedPath, args)
      warm(api.messages.getSelectedRunState, args)
    },
    [warm]
  )
}
