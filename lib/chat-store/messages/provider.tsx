"use client"

import { toast } from "@/components/ui/toast"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { DurableMessageStatus } from "@/lib/chat-messages/durable-contract"
import { extractTextFromMessageParts } from "@/lib/chat-messages/parts"
import { durableStoredMessageToUiMessage } from "@/lib/chat-messages/ui-message-adapter"
import { usePerUserQuery } from "@/lib/convex/use-per-user-query"
import type { UIMessage } from "ai"
import { useMutation } from "convex/react"
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"
import { getMessagePersistenceMode } from "../identity"
import { useChatSession } from "../session/provider"
import {
  cacheMessages,
  getCachedMessages,
  getCachedMessagesServerSnapshot,
  getCachedMessagesSnapshot,
  subscribeCachedMessages,
} from "./api"

// Extended UIMessage type for app compatibility (includes optional properties from v4)
// `metadata` stays `unknown` to match the AI SDK's `UIMessage` (so values and
// callbacks flow freely between the two); branch state is read as first-class
// typed data via `getMessageBranchInfo` / `ChatMessageMetadata` at the leaves.
export type ExtendedUIMessage = UIMessage & {
  createdAt?: Date
  content?: string
  status?: DurableMessageStatus
  metadata?: unknown
}

type MessagesContextType = {
  messages: ExtendedUIMessage[]
  isLoading: boolean
  setMessages: React.Dispatch<React.SetStateAction<ExtendedUIMessage[]>>
  /** Cache message locally and persist to Convex. Pass overrideChatId to handle stale closures during chat creation. */
  cacheAndAddMessage: (
    message: ExtendedUIMessage,
    overrideChatId?: string
  ) => Promise<void>
  resetMessages: () => Promise<void>
  selectMessageBranch: (messageId: string) => Promise<void>
}

const MessagesContext = createContext<MessagesContextType | null>(null)

export function useMessages() {
  const context = useContext(MessagesContext)
  if (!context)
    throw new Error("useMessages must be used within MessagesProvider")
  return context
}

export function MessagesProvider({ children }: { children: React.ReactNode }) {
  const { chatId } = useChatSession()
  const messagePersistenceMode = chatId
    ? getMessagePersistenceMode(chatId)
    : null

  // Only query if chatId is a valid Convex ID (not optimistic or local guest chat)
  const isValidConvexId = messagePersistenceMode === "server"

  // Convex real-time query for messages. getForChat requires an owned chat, so
  // the Per-user subscription seam also gates it on Convex auth readiness —
  // avoiding a throw if the subscription opens before the JWT is synced.
  const {
    data: convexMessages,
    isAuthReady: canSubscribeToMessages,
    isLoading: isMessagesLoading,
  } = usePerUserQuery(
    api.messages.getForChat,
    isValidConvexId ? { chatId: chatId as Id<"chats"> } : "skip"
  )

  // Convex mutations
  const addMessageMutation = useMutation(api.messages.add)
  const selectBranchMutation = useMutation(api.messages.selectBranch)

  // Convert Convex messages to AI SDK format
  const serverMessages: ExtendedUIMessage[] = useMemo(() => {
    if (!canSubscribeToMessages || !convexMessages) return []
    return convexMessages.map((msg) =>
      durableStoredMessageToUiMessage(msg)
    ) as ExtendedUIMessage[]
  }, [canSubscribeToMessages, convexMessages])

  const isLoading = isValidConvexId && isMessagesLoading

  const subscribeToCachedMessages = useCallback(
    (listener: () => void) => {
      if (!chatId || messagePersistenceMode !== "localOnly") return () => {}
      return subscribeCachedMessages(chatId, listener)
    },
    [chatId, messagePersistenceMode]
  )
  const localMessages = useSyncExternalStore(
    subscribeToCachedMessages,
    () =>
      getCachedMessagesSnapshot(
        messagePersistenceMode === "localOnly" ? chatId : null
      ),
    getCachedMessagesServerSnapshot
  )

  // Track optimistic messages per chat (keyed by chatId for natural isolation)
  const [optimisticMessagesMap, setOptimisticMessagesMap] = useState<
    Map<string, ExtendedUIMessage[]>
  >(new Map())

  // Get optimistic messages for current chat (memoized to prevent unnecessary re-renders)
  const optimisticMessages = useMemo(
    () => (chatId ? (optimisticMessagesMap.get(chatId) ?? []) : []),
    [chatId, optimisticMessagesMap]
  )

  // Derive displayed messages from server data + optimistic messages
  const messages = useMemo(() => {
    // If chatId is null, return empty
    if (chatId === null) return []

    const storedMessages =
      messagePersistenceMode === "localOnly" ? localMessages : serverMessages

    // Merge stored messages with optimistic messages for this chat
    // Deduplicate by ID to prevent duplicate-key React errors when optimistic
    // messages overlap with stored messages or with each other (e.g. rapid submissions)
    const seenIds = new Set<string>()
    const result: ExtendedUIMessage[] = []

    // Stored messages take priority
    for (const m of storedMessages) {
      if (!seenIds.has(m.id)) {
        seenIds.add(m.id)
        result.push(m)
      }
    }

    // Append optimistic messages that aren't already represented
    for (const m of optimisticMessages) {
      if (!seenIds.has(m.id)) {
        seenIds.add(m.id)
        result.push(m)
      }
    }

    return result
  }, [
    localMessages,
    messagePersistenceMode,
    serverMessages,
    optimisticMessages,
    chatId,
  ])

  // Helper to update optimistic messages for current chat
  const updateOptimisticMessages = useCallback(
    (updater: (prev: ExtendedUIMessage[]) => ExtendedUIMessage[]) => {
      if (!chatId) return
      setOptimisticMessagesMap((prevMap) => {
        const newMap = new Map(prevMap)
        const current = newMap.get(chatId) ?? []
        newMap.set(chatId, updater(current))
        return newMap
      })
    },
    [chatId]
  )

  const cacheAndAddMessage = useCallback(
    async (message: ExtendedUIMessage, overrideChatId?: string) => {
      // Use overrideChatId to handle stale closures during chat creation flow
      const effectiveChatId = overrideChatId || chatId
      if (!effectiveChatId) return

      // The cache requires createdAt; SDK messages without it sort at epoch 0.
      const messageToCache: ExtendedUIMessage = message.createdAt
        ? message
        : { ...message, createdAt: new Date() }

      // Optimistic update - add to pending messages (use effectiveChatId for map key)
      if (effectiveChatId === chatId) {
        // Only update optimistic state if we're in the same chat context
        // Guard against duplicate IDs from rapid submissions or re-renders
        updateOptimisticMessages((prev) =>
          prev.some((m) => m.id === messageToCache.id)
            ? prev
            : [...prev, messageToCache]
        )
      }

      // Read the current IndexedDB cache and append — avoids overwriting data
      // from a prior cacheAndAddMessage call in the same async chain.  The old
      // approach ([...serverMessages, ...optimisticMessages, message]) used stale
      // closure values, causing the second call to drop the first call's message.
      const cached = await getCachedMessages(effectiveChatId)
      const allMessages = [...cached, messageToCache]
      const seenIds = new Set<string>()
      const updated = allMessages.filter((m) => {
        if (seenIds.has(m.id)) return false
        seenIds.add(m.id)
        return true
      })
      await cacheMessages(effectiveChatId, updated)

      // Persist to Convex for authenticated users (valid Convex IDs only)
      // Guest users will silently skip this (auth required for mutations)
      if (getMessagePersistenceMode(effectiveChatId) === "server") {
        try {
          const textContent =
            extractTextFromMessageParts(messageToCache.parts) ||
            messageToCache.content ||
            ""

          await addMessageMutation({
            chatId: effectiveChatId as Id<"chats">,
            clientMessageId: messageToCache.id,
            role: messageToCache.role as "user" | "assistant" | "system",
            content: textContent,
            parts: messageToCache.parts,
          })
        } catch (error) {
          // Silently fail for guests (no auth) - they only get local storage
          // For authenticated users, log the error but don't block the UI
          // The optimistic update keeps the UI responsive
          console.debug("Message persistence skipped:", error)
        }
      }
    },
    [chatId, updateOptimisticMessages, addMessageMutation]
  )

  const resetMessages = useCallback(async () => {
    updateOptimisticMessages(() => [])
  }, [updateOptimisticMessages])

  const selectMessageBranch = useCallback(
    async (messageId: string) => {
      if (!chatId || getMessagePersistenceMode(chatId) !== "server") return

      // Do NOT wipe optimistic state here. Clearing it blanked the thread until
      // the Convex query round-tripped. The selected path is owned by the
      // backend: the `selectBranch` mutation flips `selected`, the reactive
      // query pushes the new selected path, and the selected-path projection
      // seam (use-chat-core) swaps the live turn array to it — no blank.
      try {
        await selectBranchMutation({
          chatId: chatId as Id<"chats">,
          messageId: messageId as Id<"messages">,
        })
      } catch (error) {
        console.error("Failed to select message branch:", error)
        toast({ title: "Failed to switch branch", status: "error" })
      }
    },
    [chatId, selectBranchMutation]
  )

  // Callers may replace only optimistic rows; server rows remain query-owned.
  const setMessages = useCallback(
    (action: React.SetStateAction<ExtendedUIMessage[]>) => {
      if (typeof action === "function") {
        updateOptimisticMessages((prev) => {
          const allMessages = [...serverMessages, ...prev]
          const newMessages = action(allMessages)
          const serverIds = new Set(serverMessages.map((m) => m.id))
          return newMessages.filter((m) => !serverIds.has(m.id))
        })
      } else {
        const serverIds = new Set(serverMessages.map((m) => m.id))
        updateOptimisticMessages(() =>
          action.filter((m) => !serverIds.has(m.id))
        )
      }
    },
    [serverMessages, updateOptimisticMessages]
  )

  return (
    <MessagesContext.Provider
      value={{
        messages,
        isLoading,
        setMessages,
        cacheAndAddMessage,
        resetMessages,
        selectMessageBranch,
      }}
    >
      {children}
    </MessagesContext.Provider>
  )
}
