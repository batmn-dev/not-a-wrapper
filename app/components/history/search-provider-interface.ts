"use client"

import { api } from "@/convex/_generated/api"
import { convexChatToChat, type Chats } from "@/lib/chat-store/types"
import { usePerUserQuery } from "@/lib/convex/use-per-user-query"
import { useEffect, useMemo, useState } from "react"

/**
 * The history-search seam. The search UI consumes `query -> results`, never "the
 * full chat array," so bounding the sidebar window (commit 8) cannot shrink what
 * search can reach. Search is title-only and server-side
 * (`convex/chats.ts` `searchByTitle`); the subscription exists ONLY while the
 * search UI is open and a non-empty term is present.
 *
 * See docs/sidebar-chat-list-streaming-plan.md commit 3.
 */
export type SearchProvider = {
  /** The live (un-debounced) search term bound to the input. */
  query: string
  setQuery: (query: string) => void
  /** Title-matched chats from the server (full history), mapped to the UI type. */
  results: Chats[]
  /** True while a subscribed search is in flight. */
  isLoading: boolean
}

const SEARCH_DEBOUNCE_MS = 200

type SearchArgs = { term: string } | "skip"

/**
 * Resolve the args passed to the `searchByTitle` subscription. Returns `"skip"`
 * whenever the search UI is closed or the term is blank, so the subscription is
 * absent except while actively searching.
 */
function resolveSearchArgs(open: boolean, term: string): SearchArgs {
  const trimmed = term.trim()
  if (!open || trimmed.length === 0) return "skip"
  return { term: trimmed }
}

/**
 * Drive the title-search subscription from the search UI's open state. Owns the
 * query string and debounces it before subscribing. When `open` flips false the
 * term is cleared, so the subscription drops immediately and the next open
 * starts empty.
 */
export function useTitleSearchProvider(open: boolean): SearchProvider {
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [wasOpen, setWasOpen] = useState(open)

  // Reset the term when the search UI closes, so the next open starts empty and
  // the subscription drops immediately. Done at render time (React's "adjust
  // state when a prop changes" pattern) rather than in an effect.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) {
      setQuery("")
      setDebouncedQuery("")
    }
  }

  useEffect(() => {
    const handle = setTimeout(
      () => setDebouncedQuery(query),
      SEARCH_DEBOUNCE_MS
    )
    return () => clearTimeout(handle)
  }, [query])

  const searchArgs = resolveSearchArgs(open, debouncedQuery)
  const { data, isLoading } = usePerUserQuery(
    api.chats.searchByTitle,
    searchArgs
  )

  const results = useMemo(() => (data ?? []).map(convexChatToChat), [data])

  return {
    query,
    setQuery,
    results,
    isLoading: searchArgs !== "skip" && isLoading,
  }
}
