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
  query: string
  setQuery: (query: string) => void
  view: ChatHistoryView
  isLoading: boolean
  loadMore: () => void
  canLoadMore: boolean
}

/**
 * The history surface's own reads, replacing its dependency on
 * `useChats().chats`. Search mode uses the server title search
 * (`useTitleSearchProvider`); browse mode uses the paginated non-project
 * recency read — both subscribed only while the drawer is open, so the history
 * surface reaches the browseable history without holding the live full list.
 *
 * See docs/adr/0005-bounded-chat-list-window.md.
 */
export function useHistoryView(open: boolean): HistoryView {
  const search = useTitleSearchProvider(open)
  const isSearching = search.query.trim().length > 0

  const browse = usePerUserPaginatedQuery(
    api.chats.listForCurrentUserPaginated,
    open && !isSearching ? {} : "skip",
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
 * Call `onLoadMore` when the scroll container nears its bottom, including an
 * eager check for underfilled first pages. Container-agnostic: pass the viewport
 * ref (drawer ScrollArea viewport, modal overflow div). `onLoadMore` should be
 * referentially stable (the effect re-binds when it or `canLoadMore` changes).
 */
export function useInfiniteScroll(
  viewportRef: RefObject<HTMLElement | null>,
  canLoadMore: boolean,
  onLoadMore: () => void
) {
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !canLoadMore) return

    let lastLoadSnapshot: string | null = null

    const loadMoreOnceForCurrentSnapshot = () => {
      const snapshot = [
        viewport.scrollHeight,
        viewport.scrollTop,
        viewport.clientHeight,
      ].join(":")
      if (snapshot === lastLoadSnapshot) return

      lastLoadSnapshot = snapshot
      onLoadMore()
    }

    const maybeLoadMoreOnScroll = () => {
      const remaining =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
      if (remaining >= LOAD_MORE_THRESHOLD_PX) return

      loadMoreOnceForCurrentSnapshot()
    }

    const maybeLoadMoreIfUnderfilled = () => {
      if (viewport.scrollHeight > viewport.clientHeight) return

      loadMoreOnceForCurrentSnapshot()
    }

    const observeContent = (resizeObserver: ResizeObserver) => {
      resizeObserver.observe(viewport)
      for (const child of Array.from(viewport.children)) {
        resizeObserver.observe(child)
      }
    }

    maybeLoadMoreIfUnderfilled()

    viewport.addEventListener("scroll", maybeLoadMoreOnScroll, {
      passive: true,
    })

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(maybeLoadMoreIfUnderfilled)
    if (resizeObserver) observeContent(resizeObserver)

    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            if (resizeObserver) observeContent(resizeObserver)
            maybeLoadMoreIfUnderfilled()
          })
    mutationObserver?.observe(viewport, { childList: true })

    return () => {
      viewport.removeEventListener("scroll", maybeLoadMoreOnScroll)
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
    }
  }, [viewportRef, canLoadMore, onLoadMore])
}
