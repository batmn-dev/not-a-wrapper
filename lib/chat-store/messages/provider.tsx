"use client"

import { toast } from "@/components/ui/toast"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { SelectedRunProjection } from "@/convex/messages"
import type { DurableMessageStatus } from "@/lib/chat-messages/durable-contract"
import { durableStoredMessageToUiMessage } from "@/lib/chat-messages/ui-message-adapter"
import { usePerUserQuery } from "@/lib/convex/use-per-user-query"
import {
  isChatPerfClientEnabled,
  markChatPerf,
} from "@/lib/observability/chat-performance"
import { useChatNavigationPerfMarks } from "@/lib/observability/chat-performance-client"
import { useUser } from "@/lib/user-store/provider"
import type { UIMessage } from "ai"
import { useMutation } from "convex/react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
  /**
   * Raw durable facts about the chat's current run. The path and run queries
   * are delivered from one Convex transition. Null for guests,
   * public/non-owner viewers, and chats with no current run. Carries no
   * time-derived fields; the pure presentation resolver owns clock
   * classification.
   */
  selectedRun: SelectedRunProjection | null
  isLoading: boolean
  setMessages: React.Dispatch<React.SetStateAction<ExtendedUIMessage[]>>
  /** Cache a local-only message. Pass overrideChatId for detached guest turns. */
  cacheAndAddMessage: (
    message: ExtendedUIMessage,
    overrideChatId?: string
  ) => Promise<void>
  resetMessages: () => Promise<void>
  selectMessageBranch: (messageId: string) => Promise<void>
}

const MessagesContext = createContext<MessagesContextType | null>(null)
const ResetMessagesContext = createContext<
  MessagesContextType["resetMessages"] | null
>(null)

export function useMessages() {
  const context = useContext(MessagesContext)
  if (!context)
    throw new Error("useMessages must be used within MessagesProvider")
  return context
}

/** Command-only consumers do not subscribe to streaming message updates. */
export function useResetMessages() {
  const resetMessages = useContext(ResetMessagesContext)
  if (!resetMessages)
    throw new Error("useResetMessages must be used within MessagesProvider")
  return resetMessages
}

export function MessagesProvider({ children }: { children: React.ReactNode }) {
  const { chatId } = useChatSession()
  // Persistence is a property of the caller, not the id (ADR-0033): the
  // server-seeded app user marks a durable chat; a guest reads IndexedDB.
  const { user } = useUser()
  const isAuthenticated = Boolean(user?.id)
  const messagePersistenceMode = chatId
    ? getMessagePersistenceMode(isAuthenticated)
    : null

  const isDurableChat = chatId !== null && messagePersistenceMode === "server"

  // The path and run state subscribe separately so run-only writes do not
  // re-deliver the full message path. Both queries use the same chatId and
  // Convex client, so their values are delivered from one transition.
  const pathQuery = usePerUserQuery(
    api.messages.getSelectedPath,
    isDurableChat ? { chatId } : "skip"
  )
  const runStateQuery = usePerUserQuery(
    api.messages.getSelectedRunState,
    isDurableChat ? { chatId } : "skip"
  )
  const canSubscribeToMessages = pathQuery.isAuthReady
  const isMessagesLoading = pathQuery.isLoading || runStateQuery.isLoading
  const convexMessages = pathQuery.data?.selectedMessages
  const rawSelectedRun = runStateQuery.data ?? null
  // Client half of the run validation: a run may drive
  // presentation only while its assistant message is on the DELIVERED
  // selected path (the points-back half stayed server-side). Same-transition
  // delivery makes this check sound; "run known, path unknown" resolves null.
  const selectedRun = useMemo(() => {
    if (!canSubscribeToMessages || !rawSelectedRun) return null
    const onDeliveredPath =
      convexMessages?.some(
        (message) => message._id === rawSelectedRun.assistantMessageId
      ) ?? false
    return onDeliveredPath ? rawSelectedRun : null
  }, [canSubscribeToMessages, rawSelectedRun, convexMessages])

  const selectBranchMutation = useMutation(api.messages.selectBranch)

  const serverMessages: ExtendedUIMessage[] = useMemo(() => {
    if (!canSubscribeToMessages || !convexMessages) return []
    return convexMessages.map((msg) =>
      durableStoredMessageToUiMessage(msg)
    ) as ExtendedUIMessage[]
  }, [canSubscribeToMessages, convexMessages])

  // Selected-conversation client counters: selected count and
  // mapping duration, counts only — no content, no ids. Render must stay
  // pure, so the duration is measured post-commit by timing one additional
  // mapping pass of the same update; instrumentation is off by default and
  // this cost exists only in diagnostic builds (documented in the runbook).
  useEffect(() => {
    if (!isChatPerfClientEnabled()) return
    if (!canSubscribeToMessages || !convexMessages) return
    const mappingStart = performance.now()
    const mapped = convexMessages.map((msg) =>
      durableStoredMessageToUiMessage(msg)
    )
    markChatPerf("selected_conversation_client", {
      selectedCount: mapped.length,
      mappingDurationMs:
        Math.round((performance.now() - mappingStart) * 100) / 100,
    })
  }, [canSubscribeToMessages, convexMessages])

  const isLoading = isDurableChat && isMessagesLoading

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

  const [optimisticMessagesMap, setOptimisticMessagesMap] = useState<
    Map<string, ExtendedUIMessage[]>
  >(new Map())

  const optimisticMessages = useMemo(
    () => (chatId ? (optimisticMessagesMap.get(chatId) ?? []) : []),
    [chatId, optimisticMessagesMap]
  )

  const messages = useMemo(() => {
    if (chatId === null) return []

    const storedMessages =
      messagePersistenceMode === "localOnly" ? localMessages : serverMessages

    // Deduplicate by ID to prevent duplicate-key React errors when optimistic
    // messages overlap with stored messages or with each other (e.g. rapid submissions)
    const seenIds = new Set<string>()
    const result: ExtendedUIMessage[] = []

    for (const m of storedMessages) {
      if (!seenIds.has(m.id)) {
        seenIds.add(m.id)
        result.push(m)
      }
    }

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

  // Navigation/chat-switch marks + durable settlement receipt.
  // No-op unless the build-time instrumentation flag is on.
  useChatNavigationPerfMarks({
    chatId,
    isAuthoritativeLoading: isLoading,
    authoritativeMessageCount: serverMessages.length,
    totalMessageCount: messages.length,
    selectedRunStatus: selectedRun?.status ?? null,
  })

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
      const effectiveChatId = overrideChatId || chatId
      if (!effectiveChatId) return

      // The cache requires createdAt; SDK messages without it sort at epoch 0.
      const messageToCache: ExtendedUIMessage = message.createdAt
        ? message
        : { ...message, createdAt: new Date() }

      if (effectiveChatId === chatId) {
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
    },
    [chatId, updateOptimisticMessages]
  )

  const resetMessages = useCallback(async () => {
    updateOptimisticMessages(() => [])
  }, [updateOptimisticMessages])

  const selectMessageBranch = useCallback(
    async (messageId: string) => {
      if (!chatId || !isAuthenticated) return

      // Do NOT wipe optimistic state here. Clearing it blanked the thread until
      // the Convex query round-tripped. The selected path is owned by the
      // backend: the `selectBranch` mutation flips `selected`, the reactive
      // query pushes the new selected path, and the selected-path projection
      // seam (use-chat-core) swaps the live turn array to it — no blank.
      try {
        await selectBranchMutation({
          chatId,
          messageId: messageId as Id<"messages">,
        })
      } catch (error) {
        console.error("Failed to select message branch:", error)
        toast({ title: "Failed to switch branch", status: "error" })
      }
    },
    [chatId, isAuthenticated, selectBranchMutation]
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
        selectedRun,
        isLoading,
        setMessages,
        cacheAndAddMessage,
        resetMessages,
        selectMessageBranch,
      }}
    >
      <ResetMessagesContext.Provider value={resetMessages}>
        {children}
      </ResetMessagesContext.Provider>
    </MessagesContext.Provider>
  )
}
