"use client"

import { toast } from "@/components/ui/toast"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  CHAT_TITLE_PLACEHOLDER,
  INITIAL_CHAT_TITLE_GENERATION,
} from "@/lib/chat-title"
import {
  usePerUserPaginatedQuery,
  usePerUserQuery,
} from "@/lib/convex/use-per-user-query"
import type { Attachment } from "@/lib/file-handling"
import { resolveModelId } from "@/lib/models/model-id-migration"
import { useConvexAuth, useMutation } from "convex/react"
import { ConvexError } from "convex/values"
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"
import { getDefaultModelForUser, SYSTEM_PROMPT_DEFAULT } from "../../config"
import { CHAT_PUBLIC_ID_CONFLICT_CODE } from "../identity"
import { clearMessagesCache } from "../messages/api"
import { convexChatToChat, type Chats } from "../types"
import {
  cacheChat,
  deleteCachedChat,
  getCachedChatsHydratedSnapshot,
  getCachedChatsServerSnapshot,
  getCachedChatsSnapshot,
  resetCachedChatsSnapshot,
  subscribeCachedChats,
  updateCachedChat,
} from "./api"
import {
  applyOptimisticOps,
  dedupeById,
  deriveSidebarLoading,
  partitionSidebarChats,
  type OptimisticOperation,
} from "./sidebar-window"

// The bounded sidebar can only safely drop the full list because full-history
// search exists (ADR-0005) to reach out-of-window chats. Referencing
// api.chats.searchByTitle here makes removing it a compile error, so the
// sidebar can never be bounded without the search swap present.
if (!api.chats.searchByTitle) {
  throw new Error(
    "The bounded sidebar requires chats.searchByTitle (history search)."
  )
}

const SIDEBAR_WINDOW_PAGE_SIZE = 25
const CONVEX_AUTH_READY_TIMEOUT_MS = 5_000

function createConvexAuthReadinessGate() {
  let isReady = false
  const waiters = new Set<() => void>()

  return {
    wait(timeoutMs = CONVEX_AUTH_READY_TIMEOUT_MS) {
      if (isReady) return Promise.resolve(true)

      return new Promise<boolean>((resolve) => {
        let settled = false

        const settle = (isReady: boolean) => {
          if (settled) return
          settled = true
          clearTimeout(timeoutId)
          waiters.delete(markReady)
          resolve(isReady)
        }
        const markReady = () => settle(true)
        const timeoutId = setTimeout(() => settle(false), timeoutMs)

        waiters.add(markReady)
      })
    },
    markReady() {
      isReady = true
      const pendingWaiters = Array.from(waiters)
      waiters.clear()
      for (const markReady of pendingWaiters) markReady()
    },
    markNotReady() {
      isReady = false
    },
  }
}

function ConvexAuthReadySignal({
  onReady,
  onNotReady,
}: {
  onReady: () => void
  onNotReady: () => void
}) {
  // This component only mounts once Convex has confirmed the JWT. Its layout
  // synchronization releases sends that began during the external auth window
  // before another user action can start a competing chat creation.
  useLayoutEffect(() => {
    onReady()
    return onNotReady
  }, [onReady, onNotReady])
  return null
}

export type CreateFirstTurnChatInput = {
  /** The client-minted chat identity, already committed to the session
   * (ADR-0033). Guests and signed-in users share the scheme. */
  publicId: string
  model?: string
  systemPrompt?: string
  projectId?: string
  /** Stable local identity used only when auth has settled signed out. */
  guestUserId?: string
  /** The first Chat turn's user message. Durable chats persist it atomically
   * with the chat row (chats.createWithFirstTurn); local chats persist it via
   * the turn store, so only the durable path consumes it here. */
  message: { clientMessageId: string; text: string }
  /** Complete staged-attachment set to bind. Staging requires auth, so the
   * local path fails closed when this is non-empty. */
  attachmentIds: string[]
}

/**
 * A created first-turn chat. `durable` carries the atomically persisted user
 * message id (the first-turn selected-path token's tail) and the bound
 * attachment descriptors; `local` is a guest chat whose message the turn
 * store persists client-side.
 */
export type FirstTurnChat =
  | { kind: "local"; chat: Chats }
  | {
      kind: "durable"
      chat: Chats
      userMessageId: string
      attachments: Attachment[]
    }

/**
 * `conflict`: the server refused the publicId (typed
 * CHAT_PUBLIC_ID_CONFLICT_CODE) — the caller re-mints once. `undefined`: the
 * creation failed and was already reported.
 */
export type FirstTurnChatResult = FirstTurnChat | { kind: "conflict" } | undefined

function isChatPublicIdConflict(error: unknown): boolean {
  return (
    error instanceof ConvexError &&
    (error.data as { code?: string } | null)?.code ===
      CHAT_PUBLIC_ID_CONFLICT_CODE
  )
}

type ChatsContextType = {
  chats: Chats[]
  isLoading: boolean
  isLoadingMore: boolean
  loadMore: () => void
  canLoadMore: boolean
  updateTitle: (id: string, title: string) => Promise<void>
  applyGeneratedTitle: (
    id: string,
    title: string,
    generation: number
  ) => Promise<boolean>
  deleteChat: (
    id: string,
    currentChatId?: string,
    redirect?: () => void
  ) => Promise<boolean>
  createFirstTurnChat: (
    input: CreateFirstTurnChatInput
  ) => Promise<FirstTurnChatResult>
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
  const {
    isAuthenticated: isConvexAuthenticated,
    isLoading: isConvexAuthLoading,
  } = useConvexAuth()
  const [authReadinessGate] = useState(createConvexAuthReadinessGate)
  const markConvexAuthReady = useCallback(
    () => authReadinessGate.markReady(),
    [authReadinessGate]
  )
  const markConvexAuthNotReady = useCallback(
    () => authReadinessGate.markNotReady(),
    [authReadinessGate]
  )

  // Sidebar reads: a bounded recency window (including project membership) +
  // a small live pinned read, so a chat write never re-reads the whole
  // collection and both sidebar grouping modes share one source (ADR-0005).
  const recentWindow = usePerUserPaginatedQuery(
    api.chats.getRecentWindowForCurrentUser,
    {},
    { initialNumItems: SIDEBAR_WINDOW_PAGE_SIZE }
  )
  const { data: pinnedServerChats } = usePerUserQuery(
    api.chats.getPinnedForCurrentUser,
    {}
  )
  const createFirstTurnMutation = useMutation(api.chats.createWithFirstTurn)
  const updateTitleMutation = useMutation(api.chats.updateTitle)
  const applyGeneratedTitleMutation = useMutation(api.chats.applyGeneratedTitle)
  const updateModelMutation = useMutation(api.chats.updateModel)
  const togglePinMutation = useMutation(api.chats.togglePin)
  const deleteChatMutation = useMutation(api.chats.remove)

  // Convert Convex chats to unified format: the union of the recency window
  // and the (full) pinned read, deduped — so pinned chats stay present even
  // when they fall outside the window, and the optimistic overlay + sidebar
  // partition both operate over the bounded set.
  const serverChats: Chats[] = useMemo(
    () =>
      dedupeById([
        ...recentWindow.results.map(convexChatToChat),
        ...(pinnedServerChats ?? []).map(convexChatToChat),
      ]),
    [recentWindow.results, pinnedServerChats]
  )

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
    firstPagePending:
      recentWindow.status === "LoadingFirstPage" ||
      pinnedServerChats === undefined,
    shouldUseLocalChats,
    cachedChatsHydrated,
  })

  const [optimisticOps, setOptimisticOps] = useState<OptimisticOperation[]>([])

  // Derive displayed chats from server data + the id-keyed optimistic overlay.
  // When the sidebar is bounded, serverChats is the window+pinned union, so ops
  // targeting out-of-window chats are no-ops here by design (see applyOptimisticOps).
  const chats = useMemo(() => {
    const localChats = shouldUseLocalChats ? cachedLocalChats : []
    return applyOptimisticOps([...localChats, ...serverChats], optimisticOps)
  }, [cachedLocalChats, serverChats, optimisticOps, shouldUseLocalChats])

  const removeOp = useCallback(
    (predicate: (op: OptimisticOperation) => boolean) => {
      setOptimisticOps((prev) => prev.filter((op) => !predicate(op)))
    },
    []
  )

  const updateTitle = useCallback(
    async (id: string, title: string) => {
      const changes = {
        title,
        title_source: "user" as const,
        updated_at: new Date().toISOString(),
      }

      if (!userId) {
        await updateCachedChat(id, (chat) => ({ ...chat, ...changes }))
        return
      }

      setOptimisticOps((prev) => [...prev, { type: "update", id, changes }])

      try {
        await updateTitleMutation({ chatId: id, title })
        removeOp(
          (op) =>
            op.type === "update" && op.id === id && op.changes.title === title
        )
      } catch {
        removeOp(
          (op) =>
            op.type === "update" && op.id === id && op.changes.title === title
        )
        toast({ title: "Failed to update title", status: "error" })
      }
    },
    [updateTitleMutation, removeOp, userId]
  )

  const applyGeneratedTitle = useCallback(
    async (id: string, title: string, generation: number) => {
      if (userId) {
        try {
          return await applyGeneratedTitleMutation({
            chatId: id,
            title,
            generation,
          })
        } catch {
          // The server's after() backstop owns durable title delivery; this
          // client commit is only the low-latency path. A network failure or
          // a chat deleted mid-turn must not surface as an unhandled error.
          return false
        }
      }

      return await updateCachedChat(id, (chat) => {
        if (
          chat.title_source !== "provisional" ||
          chat.title_generation !== generation
        ) {
          return undefined
        }

        return {
          ...chat,
          title,
          title_source: "generated",
        }
      })
    },
    [applyGeneratedTitleMutation, userId]
  )

  const deleteChat = useCallback(
    async (id: string, currentChatId?: string, redirect?: () => void) => {
      if (!userId) {
        await deleteCachedChat(id)
        await clearMessagesCache(id)
        if (id === currentChatId && redirect) redirect()
        return true
      }

      setOptimisticOps((prev) => [...prev, { type: "delete", id }])

      try {
        await deleteChatMutation({ chatId: id })
        if (id === currentChatId && redirect) redirect()
        return true
      } catch (error) {
        removeOp((op) => op.type === "delete" && op.id === id)
        // Keep the toast generic, but retain Convex's request/error details in
        // developer diagnostics so runtime failures are actionable.
        console.error("Failed to delete durable chat:", error)
        toast({ title: "Failed to delete chat", status: "error" })
        return false
      }
    },
    [deleteChatMutation, removeOp, userId]
  )

  const createFirstTurnChat = useCallback(
    async ({
      publicId,
      model,
      systemPrompt,
      projectId,
      guestUserId,
      message,
      attachmentIds,
    }: CreateFirstTurnChatInput): Promise<FirstTurnChatResult> => {
      // The server-seeded app user is the durable-intent fact. It becomes
      // available before Convex finishes confirming the JWT, so never use the
      // transient Convex readiness boolean to downgrade that user to a guest.
      const authenticatedUserId = userId
      const shouldCreateDurableChat = Boolean(authenticatedUserId)
      const normalizedModel = resolveModelId(
        model || getDefaultModelForUser(shouldCreateDurableChat)
      )

      if (!authenticatedUserId) {
        // While Convex is still resolving auth (or reports an authenticated JWT
        // without the server-seeded app user), fail closed instead of creating a
        // local chat that would split an authenticated user's history. Staged
        // attachments only exist for authenticated users, so their presence
        // here is the same wrong-identity signal.
        if (
          isConvexAuthLoading ||
          isConvexAuthenticated ||
          !guestUserId ||
          attachmentIds.length > 0
        ) {
          toast({ title: "Failed to create chat", status: "error" })
          return
        }

        const localChat: Chats = {
          id: publicId,
          title: CHAT_TITLE_PLACEHOLDER,
          title_source: "provisional",
          title_generation: INITIAL_CHAT_TITLE_GENERATION,
          created_at: new Date().toISOString(),
          model: normalizedModel,
          system_prompt: systemPrompt || SYSTEM_PROMPT_DEFAULT,
          user_id: guestUserId,
          public: false,
          updated_at: new Date().toISOString(),
          project_id: null,
          pinned: false,
          pinned_at: null,
        }

        // Add to optimistic state (stays local, not synced to server). The
        // first message itself is the turn store's job on the local path.
        await cacheChat(localChat)

        return { kind: "local", chat: localChat }
      }

      if (!isConvexAuthenticated) {
        const authBecameReady = await authReadinessGate.wait()
        if (!authBecameReady) {
          toast({ title: "Failed to create chat", status: "error" })
          return
        }
      }

      // The sidebar row carries the committed id from the start (ADR-0033):
      // no optimistic placeholder id, no swap once the server answers.
      const optimisticChat: Chats = {
        id: publicId,
        title: CHAT_TITLE_PLACEHOLDER,
        title_source: "provisional",
        title_generation: INITIAL_CHAT_TITLE_GENERATION,
        created_at: new Date().toISOString(),
        model: normalizedModel,
        system_prompt: systemPrompt || SYSTEM_PROMPT_DEFAULT,
        user_id: authenticatedUserId,
        public: false,
        updated_at: new Date().toISOString(),
        project_id: projectId ?? null,
        pinned: false,
        pinned_at: null,
      }

      setOptimisticOps((prev) => [
        ...prev,
        { type: "add", chat: optimisticChat },
      ])

      try {
        // Atomic first-turn creation: chat + attachment binding + initial user
        // message in one Convex transaction, so a failure leaves NO chat behind
        // (the empty-chat abandonment class). See chats.createWithFirstTurn.
        const created = await createFirstTurnMutation({
          publicId,
          title: CHAT_TITLE_PLACEHOLDER,
          model: normalizedModel,
          systemPrompt: systemPrompt || SYSTEM_PROMPT_DEFAULT,
          projectId: projectId as Id<"projects"> | undefined,
          message,
          attachmentIds: attachmentIds as Id<"chatAttachments">[],
        })

        setTimeout(() => {
          removeOp((op) => op.type === "add" && op.chat.id === publicId)
        }, 1000)

        return {
          kind: "durable",
          chat: optimisticChat,
          userMessageId: created.userMessageId,
          attachments: created.attachments,
        }
      } catch (error) {
        removeOp((op) => op.type === "add" && op.chat.id === publicId)
        if (isChatPublicIdConflict(error)) return { kind: "conflict" }
        toast({ title: "Failed to create chat", status: "error" })
        return undefined
      }
    },
    [
      createFirstTurnMutation,
      authReadinessGate,
      removeOp,
      isConvexAuthenticated,
      isConvexAuthLoading,
      userId,
    ]
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

      if (!userId) {
        await updateCachedChat(id, (chat) => ({ ...chat, ...changes }))
        return
      }

      setOptimisticOps((prev) => [...prev, { type: "update", id, changes }])

      try {
        await updateModelMutation({
          chatId: id,
          model: normalizedModel,
        })
        removeOp(
          (op) =>
            op.type === "update" &&
            op.id === id &&
            op.changes.model === normalizedModel
        )
      } catch (error) {
        removeOp(
          (op) =>
            op.type === "update" &&
            op.id === id &&
            op.changes.model === normalizedModel
        )
        throw error
      }
    },
    [updateModelMutation, removeOp, userId]
  )

  const bumpChat = useCallback(
    async (id: string) => {
      const changes = { updated_at: new Date().toISOString() }
      if (!userId) {
        await updateCachedChat(id, (chat) => ({ ...chat, ...changes }))
        return
      }

      setOptimisticOps((prev) => [...prev, { type: "update", id, changes }])
      // This is a local-only operation for UI ordering, no server call needed
      setTimeout(() => {
        removeOp(
          (op) =>
            op.type === "update" &&
            op.id === id &&
            op.changes.updated_at === changes.updated_at
        )
      }, 100)
    },
    [removeOp, userId]
  )

  const togglePinned = useCallback(
    async (id: string, pinned: boolean) => {
      const now = new Date().toISOString()
      const changes = {
        pinned,
        pinned_at: pinned ? now : null,
        updated_at: now,
      }

      if (!userId) {
        await updateCachedChat(id, (chat) => ({ ...chat, ...changes }))
        return
      }

      setOptimisticOps((prev) => [...prev, { type: "update", id, changes }])

      try {
        await togglePinMutation({ chatId: id, pinned })
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
    [togglePinMutation, removeOp, userId]
  )

  const pinnedChats = useMemo(
    () => partitionSidebarChats(chats).pinned,
    [chats]
  )

  const loadMore = useCallback(() => {
    recentWindow.loadMore(SIDEBAR_WINDOW_PAGE_SIZE)
  }, [recentWindow])
  const canLoadMore = recentWindow.status === "CanLoadMore"
  const isLoadingMore = recentWindow.status === "LoadingMore"

  return (
    <>
      {isConvexAuthenticated ? (
        <ConvexAuthReadySignal
          onReady={markConvexAuthReady}
          onNotReady={markConvexAuthNotReady}
        />
      ) : null}
      <ChatsContext.Provider
        value={{
          chats,
          updateTitle,
          applyGeneratedTitle,
          deleteChat,
          createFirstTurnChat,
          resetChats,
          getChatById,
          updateChatModel,
          bumpChat,
          isLoading,
          togglePinned,
          pinnedChats,
          isLoadingMore,
          loadMore,
          canLoadMore,
        }}
      >
        {children}
      </ChatsContext.Provider>
    </>
  )
}
