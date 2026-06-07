"use client"

import { toast } from "@/components/ui/toast"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { UIMessage } from "ai"
import { useMutation, useQuery } from "convex/react"
import { createContext, useCallback, useContext, useMemo, useState } from "react"
import { getCachedMessages } from "./api"
import { getMessagePartsForDisplay } from "./message-parts"
import { getMessagePersistenceMode } from "../identity"
import { writeToIndexedDB } from "../persist"
import { useChatSession } from "../session/provider"

// Extended UIMessage type for app compatibility (includes optional properties from v4)
export type ExtendedUIMessage = UIMessage & {
  createdAt?: Date
  content?: string
  status?:
    | "submitted"
    | "streaming"
    | "completed"
    | "aborted"
    | "failed"
    | "awaiting_approval"
  metadata?: unknown
}

function getMessageId(message: {
  _id: string
  clientMessageId?: string
}): string {
  return message.clientMessageId ?? message._id
}

type MessagesContextType = {
  messages: ExtendedUIMessage[]
  isLoading: boolean
  setMessages: React.Dispatch<React.SetStateAction<ExtendedUIMessage[]>>
  refresh: () => Promise<void>
  saveAllMessages: (messages: ExtendedUIMessage[]) => Promise<void>
  /** Cache message locally and persist to Convex. Pass overrideChatId to handle stale closures during chat creation. */
  cacheAndAddMessage: (message: ExtendedUIMessage, overrideChatId?: string) => Promise<void>
  resetMessages: () => Promise<void>
  deleteMessages: () => Promise<void>
  deleteMessagesFromTimestamp: (
    timestamp: number,
    minVersion?: number
  ) => Promise<void>
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

  // Convex real-time query for messages
  const convexMessages = useQuery(
    api.messages.getForChat,
    isValidConvexId ? { chatId: chatId as Id<"chats"> } : "skip"
  )

  // Convex mutations
  const addMessageMutation = useMutation(api.messages.add)
  const addBatchMutation = useMutation(api.messages.addBatch)
  const clearMessagesMutation = useMutation(api.messages.clearForChat)
  const deleteFromTimestampMutation = useMutation(api.messages.deleteFromTimestamp)

  // Convert Convex messages to AI SDK format
  const serverMessages: ExtendedUIMessage[] = useMemo(() => {
    if (!convexMessages) return []
    return convexMessages.map((msg): ExtendedUIMessage => {
      return {
        id: getMessageId(msg),
        // v5 UIMessage supports user, assistant, system roles
        role: (msg.role === "data" ? "system" : msg.role) as "user" | "assistant" | "system",
        content: msg.content,
        createdAt: new Date(msg.createdAt),
        parts: getMessagePartsForDisplay({
          content: msg.content,
          parts: msg.parts,
          attachments: msg.attachments as unknown[] | null,
        }) as ExtendedUIMessage["parts"],
        status: msg.status,
        metadata: {
          ...((msg.metadata as Record<string, unknown> | undefined) ?? {}),
          durableStatus: msg.status,
          durableError: msg.error,
          generationRunId: msg.generationRunId,
          requestId: msg.requestId,
          model: msg.model,
          provider: msg.provider,
          finishReason: msg.finishReason,
          usage: msg.usage,
        },
      }
    })
  }, [convexMessages])

  const isLoading = convexMessages === undefined && isValidConvexId

  // Track optimistic messages per chat (keyed by chatId for natural isolation)
  const [optimisticMessagesMap, setOptimisticMessagesMap] = useState<Map<string, ExtendedUIMessage[]>>(new Map())

  // Get optimistic messages for current chat (memoized to prevent unnecessary re-renders)
  const optimisticMessages = useMemo(
    () => (chatId ? (optimisticMessagesMap.get(chatId) ?? []) : []),
    [chatId, optimisticMessagesMap]
  )

  // Derive displayed messages from server data + optimistic messages
  const messages = useMemo(() => {
    // If chatId is null, return empty
    if (chatId === null) return []

    // Merge server messages with optimistic messages for this chat
    // Deduplicate by ID to prevent duplicate-key React errors when optimistic
    // messages overlap with server messages or with each other (e.g. rapid submissions)
    const seenIds = new Set<string>()
    const result: ExtendedUIMessage[] = []

    // Server messages take priority
    for (const m of serverMessages) {
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
  }, [serverMessages, optimisticMessages, chatId])

  // Helper to update optimistic messages for current chat
  const updateOptimisticMessages = useCallback((updater: (prev: ExtendedUIMessage[]) => ExtendedUIMessage[]) => {
    if (!chatId) return
    setOptimisticMessagesMap((prevMap) => {
      const newMap = new Map(prevMap)
      const current = newMap.get(chatId) ?? []
      newMap.set(chatId, updater(current))
      return newMap
    })
  }, [chatId])

  const refresh = useCallback(async () => {
    // With Convex, data is real-time, so refresh is a no-op
  }, [])

  const cacheAndAddMessage = useCallback(async (message: ExtendedUIMessage, overrideChatId?: string) => {
    // Use overrideChatId to handle stale closures during chat creation flow
    const effectiveChatId = overrideChatId || chatId
    if (!effectiveChatId) return

    // Ensure createdAt exists for correct cache sort order (AI SDK v6
    // UIMessages don't include createdAt; without it the message sorts to
    // epoch-0 and getLastMessagesFromDb can't find it for reconciliation).
    const messageToCache: ExtendedUIMessage = message.createdAt
      ? message
      : { ...message, createdAt: new Date() }

    // Optimistic update - add to pending messages (use effectiveChatId for map key)
    if (effectiveChatId === chatId) {
      // Only update optimistic state if we're in the same chat context
      // Guard against duplicate IDs from rapid submissions or re-renders
      updateOptimisticMessages((prev) =>
        prev.some((m) => m.id === messageToCache.id) ? prev : [...prev, messageToCache]
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
    await writeToIndexedDB("messages", { id: effectiveChatId, messages: updated })

    // Persist to Convex for authenticated users (valid Convex IDs only)
    // Guest users will silently skip this (auth required for mutations)
    if (getMessagePersistenceMode(effectiveChatId) === "server") {
      try {
        const textContent = messageToCache.parts
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("") || messageToCache.content || ""

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
  }, [chatId, updateOptimisticMessages, addMessageMutation])

  const saveAllMessages = useCallback(async (newMessages: ExtendedUIMessage[]) => {
    if (!chatId || getMessagePersistenceMode(chatId) !== "server") return

    try {
      // Find new messages that need to be saved
      const existingIds = new Set(serverMessages.map((m) => m.id))
      const messagesToSave = newMessages.filter((m) => !existingIds.has(m.id))

      if (messagesToSave.length > 0) {
        await addBatchMutation({
          chatId: chatId as Id<"chats">,
          messages: messagesToSave.map((msg) => {
            const textContent = msg.parts
              .filter((p): p is { type: "text"; text: string } => p.type === "text")
              .map((p) => p.text)
              .join("") || msg.content || ""

            return {
              clientMessageId: msg.id,
              role: msg.role as "user" | "assistant" | "system",
              content: textContent,
              parts: msg.parts,
            }
          }),
        })
      }

      // Update optimistic messages to match what was saved
      updateOptimisticMessages(() => newMessages.filter((m) => !existingIds.has(m.id)))

      // Also cache locally
      await writeToIndexedDB("messages", { id: chatId, messages: newMessages })
    } catch (error) {
      console.error("Failed to save messages:", error)
      toast({ title: "Failed to save messages", status: "error" })
    }
  }, [chatId, serverMessages, addBatchMutation, updateOptimisticMessages])

  const deleteMessages = useCallback(async () => {
    if (!chatId || getMessagePersistenceMode(chatId) !== "server") return

    // Clear optimistic messages immediately
    updateOptimisticMessages(() => [])

    try {
      await clearMessagesMutation({ chatId: chatId as Id<"chats"> })
      await writeToIndexedDB("messages", { id: chatId, messages: [] })
    } catch (error) {
      console.error("Failed to delete messages:", error)
      toast({ title: "Failed to delete messages", status: "error" })
    }
  }, [chatId, clearMessagesMutation, updateOptimisticMessages])

  const resetMessages = useCallback(async () => {
    updateOptimisticMessages(() => [])
  }, [updateOptimisticMessages])

  const deleteMessagesFromTimestamp = useCallback(async (
    timestamp: number,
    minVersion?: number
  ) => {
    if (!chatId || getMessagePersistenceMode(chatId) !== "server") return

    await deleteFromTimestampMutation({
      chatId: chatId as Id<"chats">,
      timestamp,
    })

    // Local state is already trimmed by useChatCore, Convex will reactively update
    // Errors propagate to submitEdit which handles rollback and user notification
  }, [chatId, deleteFromTimestampMutation])

  // setMessages for backward compatibility - updates optimistic messages
  const setMessages = useCallback((action: React.SetStateAction<ExtendedUIMessage[]>) => {
    if (typeof action === "function") {
      updateOptimisticMessages((prev) => {
        const allMessages = [...serverMessages, ...prev]
        const newMessages = action(allMessages)
        // Keep only messages not in server data
        const serverIds = new Set(serverMessages.map((m) => m.id))
        return newMessages.filter((m) => !serverIds.has(m.id))
      })
    } else {
      // Direct set - keep only messages not in server data
      const serverIds = new Set(serverMessages.map((m) => m.id))
      updateOptimisticMessages(() => action.filter((m) => !serverIds.has(m.id)))
    }
  }, [serverMessages, updateOptimisticMessages])

  return (
    <MessagesContext.Provider
      value={{
        messages,
        isLoading,
        setMessages,
        refresh,
        saveAllMessages,
        cacheAndAddMessage,
        resetMessages,
        deleteMessages,
        deleteMessagesFromTimestamp,
      }}
    >
      {children}
    </MessagesContext.Provider>
  )
}
