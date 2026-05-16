"use client"

import { toast } from "@/components/ui/toast"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useMutation, useQuery, useConvexAuth } from "convex/react"
import { createContext, useCallback, useContext, useMemo, useState } from "react"
import { getDefaultModelForUser, SYSTEM_PROMPT_DEFAULT } from "../../config"
import { resolveModelId } from "@/lib/models/model-id-migration"
import type { Chats } from "../types"

// Types for optimistic updates
type OptimisticAdd = { type: "add"; chat: Chats }
type OptimisticUpdate = { type: "update"; id: string; changes: Partial<Chats> }
type OptimisticDelete = { type: "delete"; id: string }
type OptimisticOperation = OptimisticAdd | OptimisticUpdate | OptimisticDelete

type ChatsContextType = {
  chats: Chats[]
  refresh: () => Promise<void>
  isLoading: boolean
  updateTitle: (id: string, title: string) => Promise<void>
  deleteChat: (
    id: string,
    currentChatId?: string,
    redirect?: () => void
  ) => Promise<void>
  setChats: React.Dispatch<React.SetStateAction<Chats[]>>
  createNewChat: (
    userId: string,
    title?: string,
    model?: string,
    isAuthenticated?: boolean,
    systemPrompt?: string,
    projectId?: string
  ) => Promise<Chats | undefined>
  resetChats: () => Promise<void>
  getChatById: (id: string) => Chats | undefined
  updateChatModel: (id: string, model: string) => Promise<void>
  bumpChat: (id: string) => Promise<void>
  togglePinned: (id: string, pinned: boolean) => Promise<void>
  pinnedChats: Chats[]
}
const ChatsContext = createContext<ChatsContextType | null>(null)

export function useChats() {
  const context = useContext(ChatsContext)
  if (!context) throw new Error("useChats must be used within ChatsProvider")
  return context
}

export function ChatsProvider({
  children,
}: {
  userId?: string
  children: React.ReactNode
}) {
  // Check if Convex auth is ready (JWT token synced from WorkOS AuthKit)
  const { isAuthenticated: isConvexAuthenticated, isLoading: isConvexAuthLoading } = useConvexAuth()

  // Convex real-time query for chats
  const convexChats = useQuery(api.chats.getForCurrentUser, {})

  // Convex mutations
  const createChatMutation = useMutation(api.chats.create)
  const updateTitleMutation = useMutation(api.chats.updateTitle)
  const updateModelMutation = useMutation(api.chats.updateModel)
  const togglePinMutation = useMutation(api.chats.togglePin)
  const deleteChatMutation = useMutation(api.chats.remove)

  // Convert Convex chats to unified format
  const serverChats: Chats[] = useMemo(() => {
    if (!convexChats) return []
    return convexChats.map(
      (chat): Chats => ({
        id: chat._id,
        user_id: chat.userId,
        title: chat.title ?? null,
        model: chat.model ? resolveModelId(chat.model) : null,
        system_prompt: chat.systemPrompt ?? null,
        project_id: chat.projectId ?? null,
        public: chat.public,
        pinned: chat.pinned,
        pinned_at: chat.pinnedAt ? new Date(chat.pinnedAt).toISOString() : null,
        created_at: new Date(chat._creationTime).toISOString(),
        updated_at: chat.updatedAt
          ? new Date(chat.updatedAt).toISOString()
          : null,
      })
    )
  }, [convexChats])

  const isLoading = convexChats === undefined || isConvexAuthLoading

  // Track optimistic operations (adds, updates, deletes)
  const [optimisticOps, setOptimisticOps] = useState<OptimisticOperation[]>([])

  // Derive displayed chats from server data + optimistic operations
  const chats = useMemo(() => {
    let result = [...serverChats]

    for (const op of optimisticOps) {
      if (op.type === "add") {
        // Only add if not already in server data (by checking optimistic prefix)
        if (op.chat.id.startsWith("optimistic-") || !result.find((c) => c.id === op.chat.id)) {
          result = [op.chat, ...result.filter((c) => c.id !== op.chat.id)]
        }
      } else if (op.type === "update") {
        result = result.map((c) =>
          c.id === op.id ? { ...c, ...op.changes } : c
        )
      } else if (op.type === "delete") {
        result = result.filter((c) => c.id !== op.id)
      }
    }

    // Sort by updated_at
    return result.sort(
      (a, b) => +new Date(b.updated_at || b.created_at || "") - +new Date(a.updated_at || a.created_at || "")
    )
  }, [serverChats, optimisticOps])

  // Helper to remove an optimistic operation
  const removeOp = useCallback((predicate: (op: OptimisticOperation) => boolean) => {
    setOptimisticOps((prev) => prev.filter((op) => !predicate(op)))
  }, [])

  const refresh = async () => {
    // With Convex, data is real-time, so refresh is a no-op
    // The useQuery hook automatically updates when data changes
  }

  const updateTitle = useCallback(async (id: string, title: string) => {
    const changes = { title, updated_at: new Date().toISOString() }

    // Optimistic update
    setOptimisticOps((prev) => [...prev, { type: "update", id, changes }])

    try {
      await updateTitleMutation({ chatId: id as Id<"chats">, title })
      // Remove optimistic op after success (server data will have the update)
      removeOp((op) => op.type === "update" && op.id === id && op.changes.title === title)
    } catch {
      // Revert optimistic update
      removeOp((op) => op.type === "update" && op.id === id && op.changes.title === title)
      toast({ title: "Failed to update title", status: "error" })
    }
  }, [updateTitleMutation, removeOp])

  const deleteChat = useCallback(async (
    id: string,
    currentChatId?: string,
    redirect?: () => void
  ) => {
    // Optimistic delete
    setOptimisticOps((prev) => [...prev, { type: "delete", id }])

    try {
      await deleteChatMutation({ chatId: id as Id<"chats"> })
      if (id === currentChatId && redirect) redirect()
      // Keep the delete op until server confirms (real-time will remove the chat)
    } catch {
      // Revert optimistic delete
      removeOp((op) => op.type === "delete" && op.id === id)
      toast({ title: "Failed to delete chat", status: "error" })
    }
  }, [deleteChatMutation, removeOp])

  const createNewChat = useCallback(async (
    userId: string,
    title?: string,
    model?: string,
    isAuthenticated?: boolean,
    systemPrompt?: string,
    projectId?: string
  ): Promise<Chats | undefined> => {
    if (!userId) return
    const normalizedModel = resolveModelId(
      model || getDefaultModelForUser(!!isAuthenticated)
    )

    // For guest users, create a local-only chat (not persisted to Convex)
    // This allows unauthenticated users to send messages without database errors
    if (!isAuthenticated) {
      const localChatId = `local-${crypto.randomUUID()}`
      const localChat: Chats = {
        id: localChatId,
        title: title || "New chat",
        created_at: new Date().toISOString(),
        model: normalizedModel,
        system_prompt: systemPrompt || SYSTEM_PROMPT_DEFAULT,
        user_id: userId,
        public: false,
        updated_at: new Date().toISOString(),
        project_id: null,
        pinned: false,
        pinned_at: null,
      }

      // Add to optimistic state (stays local, not synced to server)
      setOptimisticOps((prev) => [...prev, { type: "add", chat: localChat }])

      return localChat
    }

    // For authenticated users, ensure Convex auth is ready before calling mutations
    // This prevents "Not authenticated" errors due to AuthKit to Convex auth sync delay
    if (isAuthenticated && !isConvexAuthenticated && !isConvexAuthLoading) {
      console.warn("createNewChat: Convex auth not ready yet, waiting...")
      // Wait a bit for auth to sync
      await new Promise((resolve) => setTimeout(resolve, 500))
    }

    const optimisticId = `optimistic-${crypto.randomUUID()}`
    const optimisticChat: Chats = {
      id: optimisticId,
      title: title || "New chat",
      created_at: new Date().toISOString(),
      model: normalizedModel,
      system_prompt: systemPrompt || SYSTEM_PROMPT_DEFAULT,
      user_id: userId,
      public: false,
      updated_at: new Date().toISOString(),
      project_id: null,
      pinned: false,
      pinned_at: null,
    }

    // Optimistic add
    setOptimisticOps((prev) => [...prev, { type: "add", chat: optimisticChat }])

    try {
      const chatId = await createChatMutation({
        title: title || "New chat",
        model: normalizedModel,
        systemPrompt: systemPrompt || SYSTEM_PROMPT_DEFAULT,
        projectId: projectId as Id<"projects"> | undefined,
      })

      const newChat: Chats = {
        ...optimisticChat,
        id: chatId,
      }

      // Replace optimistic with real chat
      setOptimisticOps((prev) => {
        const filtered = prev.filter(
          (op) => !(op.type === "add" && op.chat.id === optimisticId)
        )
        return [...filtered, { type: "add", chat: newChat }]
      })

      // Clean up after server sync
      setTimeout(() => {
        removeOp((op) => op.type === "add" && op.chat.id === chatId)
      }, 1000)

      return newChat
    } catch {
      // Revert optimistic add
      removeOp((op) => op.type === "add" && op.chat.id === optimisticId)
      toast({ title: "Failed to create chat", status: "error" })
      return undefined
    }
  }, [createChatMutation, removeOp, isConvexAuthenticated, isConvexAuthLoading])

  const resetChats = useCallback(async () => {
    setOptimisticOps([])
  }, [])

  const getChatById = useCallback((id: string) => {
    return chats.find((c) => c.id === id)
  }, [chats])

  const updateChatModel = useCallback(async (id: string, model: string) => {
    const normalizedModel = resolveModelId(model)
    const changes = { model: normalizedModel }

    // Optimistic update
    setOptimisticOps((prev) => [...prev, { type: "update", id, changes }])

    try {
      await updateModelMutation({ chatId: id as Id<"chats">, model: normalizedModel })
      removeOp((op) => op.type === "update" && op.id === id && op.changes.model === normalizedModel)
    } catch {
      removeOp((op) => op.type === "update" && op.id === id && op.changes.model === normalizedModel)
      toast({ title: "Failed to update model", status: "error" })
    }
  }, [updateModelMutation, removeOp])

  const bumpChat = useCallback(async (id: string) => {
    const changes = { updated_at: new Date().toISOString() }
    setOptimisticOps((prev) => [...prev, { type: "update", id, changes }])
    // This is a local-only operation for UI ordering, no server call needed
    // Clean up after a short delay
    setTimeout(() => {
      removeOp((op) => op.type === "update" && op.id === id && op.changes.updated_at === changes.updated_at)
    }, 100)
  }, [removeOp])

  const togglePinned = useCallback(async (id: string, pinned: boolean) => {
    const now = new Date().toISOString()
    const changes = { pinned, pinned_at: pinned ? now : null }

    // Optimistic update
    setOptimisticOps((prev) => [...prev, { type: "update", id, changes }])

    try {
      await togglePinMutation({ chatId: id as Id<"chats">, pinned })
      removeOp((op) => op.type === "update" && op.id === id && op.changes.pinned === pinned)
    } catch {
      removeOp((op) => op.type === "update" && op.id === id && op.changes.pinned === pinned)
      toast({ title: "Failed to update pin", status: "error" })
    }
  }, [togglePinMutation, removeOp])

  const pinnedChats = useMemo(
    () =>
      chats
        .filter((c) => c.pinned && !c.project_id)
        .slice()
        .sort((a, b) => {
          const at = a.pinned_at ? +new Date(a.pinned_at) : 0
          const bt = b.pinned_at ? +new Date(b.pinned_at) : 0
          return bt - at
        }),
    [chats]
  )

  // setChats is kept for backward compatibility but now manages optimistic ops
  const setChats = useCallback((action: React.SetStateAction<Chats[]>) => {
    // For direct sets, clear optimistic ops and let server be source of truth
    if (typeof action === "function") {
      // Can't easily support functional updates with optimistic ops
      // Just clear ops and let Convex handle it
      setOptimisticOps([])
    } else {
      setOptimisticOps([])
    }
  }, [])

  return (
    <ChatsContext.Provider
      value={{
        chats,
        refresh,
        updateTitle,
        deleteChat,
        setChats,
        createNewChat,
        resetChats,
        getChatById,
        updateChatModel,
        bumpChat,
        isLoading,
        togglePinned,
        pinnedChats,
      }}
    >
      {children}
    </ChatsContext.Provider>
  )
}
