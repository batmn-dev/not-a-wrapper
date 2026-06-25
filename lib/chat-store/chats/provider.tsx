"use client"

import { toast } from "@/components/ui/toast"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { resolveModelId } from "@/lib/models/model-id-migration"
import {
  usePerUserPaginatedQuery,
  usePerUserQuery,
} from "@/lib/convex/use-per-user-query"
import { ENABLE_PAGINATED_SIDEBAR } from "@/lib/flags"
import { useConvexAuth, useMutation } from "convex/react"
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"
import { getDefaultModelForUser, SYSTEM_PROMPT_DEFAULT } from "../../config"
import {
  createLocalChatId,
  createOptimisticChatId,
  isLocalChatId,
} from "../identity"
import { clearMessagesCache } from "../messages/api"
import type { Chats } from "../types"
import {
  cacheChat,
  deleteCachedChat,
  getCachedChat,
  getCachedChatsHydratedSnapshot,
  getCachedChatsServerSnapshot,
  getCachedChatsSnapshot,
  hydrateCachedChats,
  resetCachedChatsSnapshot,
  subscribeCachedChats,
} from "./api"
import {
  applyOptimisticOps,
  dedupeById,
  deriveSidebarLoading,
  mapConvexChat,
  partitionSidebarChats,
  type OptimisticOperation,
} from "./sidebar-window"

// The bounded sidebar (ENABLE_PAGINATED_SIDEBAR) can only safely drop the full
// list because full-history search exists (commit 3) to reach out-of-window
// chats. Referencing api.chats.searchByTitle here makes removing it a compile
// error, so the sidebar can never be bounded without the search swap present.
if (ENABLE_PAGINATED_SIDEBAR && !api.chats.searchByTitle) {
  throw new Error(
    "ENABLE_PAGINATED_SIDEBAR requires chats.searchByTitle (history search)."
  )
}

const SIDEBAR_WINDOW_PAGE_SIZE = 25

type ChatsContextType = {
  chats: Chats[]
  refresh: () => Promise<void>
  isLoading: boolean
  /** Load the next page of the bounded sidebar window (no-op when the flag is off). */
  loadMore: () => void
  /** True when more sidebar window pages can be loaded. */
  canLoadMore: boolean
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
  userId,
  children,
}: {
  userId?: string
  children: React.ReactNode
}) {
  // Check if Convex auth is ready (JWT token synced from WorkOS AuthKit)
  const {
    isAuthenticated: isConvexAuthenticated,
    isLoading: isConvexAuthLoading,
  } = useConvexAuth()

  // Sidebar reads. Both code paths' hooks are always called (rules of hooks);
  // the inactive path passes "skip" so it never subscribes. Flag OFF: the full
  // list. Flag ON: a bounded recency window + a small live pinned read, so a
  // chat write no longer re-reads the whole collection.
  const { data: convexChats } = usePerUserQuery(
    api.chats.getForCurrentUser,
    ENABLE_PAGINATED_SIDEBAR ? "skip" : {}
  )
  const recentWindow = usePerUserPaginatedQuery(
    api.chats.listForCurrentUserPaginated,
    ENABLE_PAGINATED_SIDEBAR ? {} : "skip",
    { initialNumItems: SIDEBAR_WINDOW_PAGE_SIZE }
  )
  const { data: pinnedServerChats } = usePerUserQuery(
    api.chats.getPinnedForCurrentUser,
    ENABLE_PAGINATED_SIDEBAR ? {} : "skip"
  )

  // Convex mutations
  const createChatMutation = useMutation(api.chats.create)
  const updateTitleMutation = useMutation(api.chats.updateTitle)
  const updateModelMutation = useMutation(api.chats.updateModel)
  const togglePinMutation = useMutation(api.chats.togglePin)
  const deleteChatMutation = useMutation(api.chats.remove)

  // Convert Convex chats to unified format. Flag ON: the union of the recency
  // window and the (full) pinned read, deduped — so pinned chats stay present
  // even when they fall outside the window, and the optimistic overlay + sidebar
  // partition both operate over the bounded set. Flag OFF: the full list.
  const serverChats: Chats[] = useMemo(() => {
    if (ENABLE_PAGINATED_SIDEBAR) {
      return dedupeById([
        ...recentWindow.results.map(mapConvexChat),
        ...(pinnedServerChats ?? []).map(mapConvexChat),
      ])
    }
    if (!convexChats) return []
    return convexChats.map(mapConvexChat)
  }, [convexChats, recentWindow.results, pinnedServerChats])

  const cachedLocalChats = useSyncExternalStore(
    subscribeCachedChats,
    getCachedChatsSnapshot,
    getCachedChatsServerSnapshot
  )
  const cachedChatsHydrated = useSyncExternalStore(
    subscribeCachedChats,
    getCachedChatsHydratedSnapshot,
    () => false
  )
  const shouldUseLocalChats =
    !userId && !isConvexAuthenticated && !isConvexAuthLoading

  const isLoading = deriveSidebarLoading({
    isConvexAuthLoading,
    isConvexAuthenticated,
    paginated: ENABLE_PAGINATED_SIDEBAR,
    fullListPending: convexChats === undefined,
    // Paginated path: ready once the first window page AND pinned read arrive.
    firstPagePending:
      recentWindow.status === "LoadingFirstPage" ||
      pinnedServerChats === undefined,
    shouldUseLocalChats,
    cachedChatsHydrated,
  })

  // Track optimistic operations (adds, updates, deletes)
  const [optimisticOps, setOptimisticOps] = useState<OptimisticOperation[]>([])

  // Derive displayed chats from server data + the id-keyed optimistic overlay.
  // When the sidebar is bounded, serverChats is the window+pinned union, so ops
  // targeting out-of-window chats are no-ops here by design (see applyOptimisticOps).
  const chats = useMemo(() => {
    const localChats = shouldUseLocalChats ? cachedLocalChats : []
    return applyOptimisticOps([...localChats, ...serverChats], optimisticOps)
  }, [cachedLocalChats, serverChats, optimisticOps, shouldUseLocalChats])

  // Helper to remove an optimistic operation
  const removeOp = useCallback(
    (predicate: (op: OptimisticOperation) => boolean) => {
      setOptimisticOps((prev) => prev.filter((op) => !predicate(op)))
    },
    []
  )

  const refresh = async () => {
    if (shouldUseLocalChats) {
      await hydrateCachedChats()
    }
    // With Convex, data is real-time, so refresh is a no-op
    // The useQuery hook automatically updates when data changes
  }

  const updateTitle = useCallback(
    async (id: string, title: string) => {
      const changes = { title, updated_at: new Date().toISOString() }

      if (isLocalChatId(id)) {
        const chat =
          (await getCachedChat(id)) ??
          chats.find((candidate) => candidate.id === id)
        if (!chat) return

        await cacheChat({ ...chat, ...changes })
        return
      }

      // Optimistic update
      setOptimisticOps((prev) => [...prev, { type: "update", id, changes }])

      try {
        await updateTitleMutation({ chatId: id as Id<"chats">, title })
        // Remove optimistic op after success (server data will have the update)
        removeOp(
          (op) =>
            op.type === "update" && op.id === id && op.changes.title === title
        )
      } catch {
        // Revert optimistic update
        removeOp(
          (op) =>
            op.type === "update" && op.id === id && op.changes.title === title
        )
        toast({ title: "Failed to update title", status: "error" })
      }
    },
    [chats, updateTitleMutation, removeOp]
  )

  const deleteChat = useCallback(
    async (id: string, currentChatId?: string, redirect?: () => void) => {
      if (isLocalChatId(id)) {
        await deleteCachedChat(id)
        await clearMessagesCache(id)
        if (id === currentChatId && redirect) redirect()
        return
      }

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
    },
    [deleteChatMutation, removeOp]
  )

  const createNewChat = useCallback(
    async (
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
        const localChatId = createLocalChatId()
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
        await cacheChat(localChat)

        return localChat
      }

      // For authenticated users, ensure Convex auth is ready before calling mutations
      // This prevents "Not authenticated" errors due to AuthKit to Convex auth sync delay
      if (isAuthenticated && !isConvexAuthenticated && !isConvexAuthLoading) {
        console.warn("createNewChat: Convex auth not ready yet, waiting...")
        // Wait a bit for auth to sync
        await new Promise((resolve) => setTimeout(resolve, 500))
      }

      const optimisticId = createOptimisticChatId()
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
      setOptimisticOps((prev) => [
        ...prev,
        { type: "add", chat: optimisticChat },
      ])

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
    },
    [createChatMutation, removeOp, isConvexAuthenticated, isConvexAuthLoading]
  )

  const resetChats = useCallback(async () => {
    setOptimisticOps([])
    resetCachedChatsSnapshot()
  }, [])

  const getChatById = useCallback(
    (id: string) => {
      return chats.find((c) => c.id === id)
    },
    [chats]
  )

  const updateChatModel = useCallback(
    async (id: string, model: string) => {
      const normalizedModel = resolveModelId(model)
      const changes = {
        model: normalizedModel,
        updated_at: new Date().toISOString(),
      }

      if (isLocalChatId(id)) {
        const chat =
          (await getCachedChat(id)) ??
          chats.find((candidate) => candidate.id === id)
        if (!chat) return

        await cacheChat({ ...chat, ...changes })
        return
      }

      // Optimistic update
      setOptimisticOps((prev) => [...prev, { type: "update", id, changes }])

      try {
        await updateModelMutation({
          chatId: id as Id<"chats">,
          model: normalizedModel,
        })
        removeOp(
          (op) =>
            op.type === "update" &&
            op.id === id &&
            op.changes.model === normalizedModel
        )
      } catch {
        removeOp(
          (op) =>
            op.type === "update" &&
            op.id === id &&
            op.changes.model === normalizedModel
        )
        toast({ title: "Failed to update model", status: "error" })
      }
    },
    [chats, updateModelMutation, removeOp]
  )

  const bumpChat = useCallback(
    async (id: string) => {
      const changes = { updated_at: new Date().toISOString() }
      if (isLocalChatId(id)) {
        const chat =
          (await getCachedChat(id)) ??
          chats.find((candidate) => candidate.id === id)
        if (!chat) return

        await cacheChat({ ...chat, ...changes })
        return
      }

      setOptimisticOps((prev) => [...prev, { type: "update", id, changes }])
      // This is a local-only operation for UI ordering, no server call needed
      // Clean up after a short delay
      setTimeout(() => {
        removeOp(
          (op) =>
            op.type === "update" &&
            op.id === id &&
            op.changes.updated_at === changes.updated_at
        )
      }, 100)
    },
    [chats, removeOp]
  )

  const togglePinned = useCallback(
    async (id: string, pinned: boolean) => {
      const now = new Date().toISOString()
      const changes = {
        pinned,
        pinned_at: pinned ? now : null,
        updated_at: now,
      }

      if (isLocalChatId(id)) {
        const chat =
          (await getCachedChat(id)) ??
          chats.find((candidate) => candidate.id === id)
        if (!chat) return

        await cacheChat({ ...chat, ...changes })
        return
      }

      // Optimistic update
      setOptimisticOps((prev) => [...prev, { type: "update", id, changes }])

      try {
        await togglePinMutation({ chatId: id as Id<"chats">, pinned })
        removeOp(
          (op) =>
            op.type === "update" && op.id === id && op.changes.pinned === pinned
        )
      } catch {
        removeOp(
          (op) =>
            op.type === "update" && op.id === id && op.changes.pinned === pinned
        )
        toast({ title: "Failed to update pin", status: "error" })
      }
    },
    [chats, togglePinMutation, removeOp]
  )

  const pinnedChats = useMemo(
    () => partitionSidebarChats(chats).pinned,
    [chats]
  )

  // Load-more for the bounded sidebar window. No-op when the flag is off.
  const loadMore = useCallback(() => {
    if (ENABLE_PAGINATED_SIDEBAR) {
      recentWindow.loadMore(SIDEBAR_WINDOW_PAGE_SIZE)
    }
  }, [recentWindow])
  const canLoadMore =
    ENABLE_PAGINATED_SIDEBAR && recentWindow.status === "CanLoadMore"

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
        loadMore,
        canLoadMore,
      }}
    >
      {children}
    </ChatsContext.Provider>
  )
}
