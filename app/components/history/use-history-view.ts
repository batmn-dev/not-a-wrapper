"use client"

import { api } from "@/convex/_generated/api"
import { convexChatToChat, type Chats } from "@/lib/chat-store/types"
import { usePerUserPaginatedQuery } from "@/lib/convex/use-per-user-query"
import { useCallback, useEffect, useMemo, type RefObject } from "react"
import { useTitleSearchProvider } from "./search-provider-interface"
import { buildChatHistoryView, type ChatHistoryView } from "./utils"

const BROWSE_PAGE_SIZE = 25
const LOAD_MORE_THRESHOLD_PX = 240

export type HistoryView = {
  /** Live search term bound to the input. */
  query: string
  setQuery: (query: string) => void
  /** Grouped/derived list for rendering — search results OR browse groups. */
  view: ChatHistoryView
  /** True while the active mode's read is in flight. */
  isLoading: boolean
  /** Load the next browse page (no-op while searching or exhausted). */
  loadMore: () => void
  /** True when more browse pages can be loaded. */
  canLoadMore: boolean
}

/**
 * The history surface's own reads, replacing its dependency on
 * `useChats().chats`. Search mode uses the server title search
 * (`useTitleSearchProvider`); browse mode uses the paginated `by_user_updated`
 * read — both subscribed only while the drawer is open, so the history surface
 * reaches the full history without holding the live full list.
 *
 * See docs/sidebar-chat-list-streaming-plan.md commit 4.
 */
export function useHistoryView(open: boolean): HistoryView {
  const search = useTitleSearchProvider(open)
  const isSearching = search.query.trim().length > 0

  const browse = usePerUserPaginatedQuery(
    api.chats.listForCurrentUserPaginated,
    open ? {} : "skip",
    { initialNumItems: BROWSE_PAGE_SIZE }
  )

  const browseChats = useMemo<Chats[]>(
    () => browse.results.map(convexChatToChat),
    [browse.results]
  )

  // Search results come straight from the server (already title-matched); only
  // the browse corpus flows through buildChatHistoryView's date grouping.
  const view = useMemo<ChatHistoryView>(
    () =>
      isSearching
        ? { isSearching: true, results: search.results, pinned: [], groups: [] }
        : buildChatHistoryView(browseChats, ""),
    [isSearching, search.results, browseChats]
  )

  const browseLoadMore = browse.loadMore
  const loadMore = useCallback(
    () => browseLoadMore(BROWSE_PAGE_SIZE),
    [browseLoadMore]
  )

  return {
    query: search.query,
    setQuery: search.setQuery,
    view,
    isLoading: isSearching ? search.isLoading : browse.isLoading,
    loadMore,
    canLoadMore: !isSearching && browse.status === "CanLoadMore",
  }
}

/**
 * Call `onLoadMore` when the scroll container nears its bottom. Container-
 * agnostic: pass the viewport ref (drawer ScrollArea viewport, modal overflow
 * div). `onLoadMore` should be referentially stable (the effect re-binds when it
 * or `canLoadMore` changes).
 */
export function useInfiniteScroll(
  viewportRef: RefObject<HTMLElement | null>,
  canLoadMore: boolean,
  onLoadMore: () => void
) {
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !canLoadMore) return

    const handleScroll = () => {
      const remaining =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
      if (remaining < LOAD_MORE_THRESHOLD_PX) onLoadMore()
    }

    viewport.addEventListener("scroll", handleScroll, { passive: true })
    return () => viewport.removeEventListener("scroll", handleScroll)
  }, [viewportRef, canLoadMore, onLoadMore])
}
