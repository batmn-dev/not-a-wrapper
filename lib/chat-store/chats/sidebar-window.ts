import type { Doc } from "@/convex/_generated/dataModel"
import { resolveModelId } from "@/lib/models/model-id-migration"
import { isOptimisticChatId } from "../identity"
import type { Chats } from "../types"

// Optimistic updates layered over the server data (adds, updates, deletes).
export type OptimisticAdd = { type: "add"; chat: Chats }
export type OptimisticUpdate = {
  type: "update"
  id: string
  changes: Partial<Chats>
}
export type OptimisticDelete = { type: "delete"; id: string }
export type OptimisticOperation =
  OptimisticAdd | OptimisticUpdate | OptimisticDelete

/** Map a stored Convex chat to the unified client Chat type. */
export function mapConvexChat(chat: Doc<"chats">): Chats {
  return {
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
    updated_at: chat.updatedAt ? new Date(chat.updatedAt).toISOString() : null,
    live_run_status: chat.liveRunStatus ?? null,
    last_run_ended_at: chat.lastRunEndedAt ?? null,
    last_run_status: chat.lastRunStatus ?? null,
    last_read_at: chat.lastReadAt ?? null,
  }
}

/** Keep the first occurrence of each chat id (window before pinned). */
export function dedupeById(chats: Chats[]): Chats[] {
  const seen = new Set<string>()
  const result: Chats[] = []
  for (const chat of chats) {
    if (seen.has(chat.id)) continue
    seen.add(chat.id)
    result.push(chat)
  }
  return result
}

/** Newest activity first; falls back to created_at when updated_at is absent. */
export function sortByRecency(chats: Chats[]): Chats[] {
  return [...chats].sort(
    (a, b) =>
      +new Date(b.updated_at || b.created_at || "") -
      +new Date(a.updated_at || a.created_at || "")
  )
}

/**
 * Apply the optimistic overlay to whatever list a surface holds (the full list,
 * or — when the sidebar is bounded — the recency window + pinned union), then
 * sort by recency. The overlay is id-keyed: an update/delete that targets a chat
 * NOT in `base` is a no-op. For the bounded sidebar that means ops on
 * out-of-window chats are silently ignored here, by design — the surface that
 * shows them (history drawer / project view) reflects them via its own read.
 */
export function applyOptimisticOps(
  base: Chats[],
  ops: OptimisticOperation[]
): Chats[] {
  let result = [...base]

  for (const op of ops) {
    if (op.type === "add") {
      // Optimistic-id adds always prepend; real-id adds only if not already
      // present (server data may already carry it).
      if (
        isOptimisticChatId(op.chat.id) ||
        !result.find((c) => c.id === op.chat.id)
      ) {
        result = [op.chat, ...result.filter((c) => c.id !== op.chat.id)]
      }
    } else if (op.type === "update") {
      result = result.map((c) => (c.id === op.id ? { ...c, ...op.changes } : c))
    } else if (op.type === "delete") {
      result = result.filter((c) => c.id !== op.id)
    }
  }

  return sortByRecency(result)
}

/**
 * Split the sidebar chats into the pinned section and the recent ("Chats")
 * section. Project chats belong to the project view, not the sidebar, so they
 * are excluded from both. A chat is pinned XOR not, so the two sections never
 * intersect. Pinned are ordered newest-pin first.
 */
export function partitionSidebarChats(chats: Chats[]): {
  pinned: Chats[]
  nonPinned: Chats[]
} {
  const pinned: Chats[] = []
  const nonPinned: Chats[] = []

  for (const chat of chats) {
    if (chat.project_id) continue
    if (chat.pinned) pinned.push(chat)
    else nonPinned.push(chat)
  }

  pinned.sort((a, b) => {
    const at = a.pinned_at ? +new Date(a.pinned_at) : 0
    const bt = b.pinned_at ? +new Date(b.pinned_at) : 0
    return bt - at
  })

  return { pinned, nonPinned }
}

/**
 * The sidebar's loading state. With the flag off it means "the full chat list
 * has loaded" (legacy). With the flag on it means **"the first window page is
 * ready"** (not "all chats loaded") — so the sidebar paints as soon as the first
 * page + pinned arrive, and load-more streams the rest.
 */
export function deriveSidebarLoading(params: {
  isConvexAuthLoading: boolean
  isConvexAuthenticated: boolean
  paginated: boolean
  /** Legacy path: chats.getForCurrentUser still undefined. */
  fullListPending: boolean
  /** Paginated path: first window page or pinned read not yet ready. */
  firstPagePending: boolean
  shouldUseLocalChats: boolean
  cachedChatsHydrated: boolean
}): boolean {
  return (
    params.isConvexAuthLoading ||
    (params.isConvexAuthenticated &&
      (params.paginated ? params.firstPagePending : params.fullListPending)) ||
    (params.shouldUseLocalChats && !params.cachedChatsHydrated)
  )
}
