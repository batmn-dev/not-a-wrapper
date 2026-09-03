"use client"

/**
 * Warm client query cache (ADR-0031): the convex-helpers query cache mounted
 * at the Convex client boundary with bounded idle retention, plus the warm
 * (preload) primitive. A query a consumer unmounts stays subscribed for the
 * idle TTL, so the next consumer of the same query and args — a revisited
 * chat, typically — renders its delivered value on the first commit instead
 * of a loading state. Delivery still flows through `convex/react`'s core
 * `useQueries` on the one `ConvexReactClient`, so ADR-0027's same-transition
 * guarantee for the split selected-conversation pair is untouched: the cache
 * only holds subscriptions open, it never re-delivers values.
 */
import {
  ConvexQueryCacheContext,
  ConvexQueryCacheProvider,
} from "convex-helpers/react/cache/provider"
import { useConvexAuth } from "convex/react"
import {
  getFunctionName,
  type FunctionArgs,
  type FunctionReference,
} from "convex/server"
import { convexToJson } from "convex/values"
import { useCallback, useContext, type ReactNode } from "react"

/**
 * How long an unmounted query stays subscribed. Sidebar back-and-forth
 * between recent threads happens within a couple of minutes of leaving one;
 * past that, an idle subscription is more likely to be paying re-execution
 * cost for writes to a chat nobody is looking at (the ADR-0004 cost lens)
 * than to save a switch. Warming a query again restarts its TTL.
 */
export const QUERY_CACHE_IDLE_TTL_MS = 120_000

/**
 * Idle-subscription cap, independent of the TTL: 16 chats × the two
 * selected-conversation queries. At the cap a departing query is dropped
 * instead of parked, so a long switching session retains at most this many
 * idle result sets (a selected path measured ~23 KB, so well under 1 MB).
 */
export const QUERY_CACHE_MAX_IDLE_ENTRIES = 32

export function ConvexQueryCache({ children }: { children: ReactNode }) {
  return (
    <ConvexQueryCacheProvider
      expiration={QUERY_CACHE_IDLE_TTL_MS}
      maxIdleEntries={QUERY_CACHE_MAX_IDLE_ENTRIES}
    >
      {children}
    </ConvexQueryCacheProvider>
  )
}

/**
 * The cache's own key derivation (convex-helpers `react/cache/hooks.ts`,
 * `createQueryKey`, not exported), mirrored so a warmed entry is the one the
 * cached `useQuery` joins. query-cache.test.tsx pins the two agreeing.
 */
function cacheQueryKey<Query extends FunctionReference<"query">>(
  query: Query,
  args: FunctionArgs<Query>
): string {
  return JSON.stringify([getFunctionName(query), convexToJson(args)])
}

/**
 * Returns `warm(query, args)`: opens the per-user query's subscription ahead
 * of its consumer and parks it in the cache for the idle TTL. Gated on Convex
 * auth readiness like `usePerUserQuery`, so it can never open a wrong-empty
 * read before the JWT syncs. A no-op without the cache provider, or when a
 * new entry would exceed the idle cap (parking would drop it on the spot and
 * the subscribe would be wasted).
 *
 * Mechanism: the cache exposes no preload API, but a consumer that mounts
 * and unmounts leaves exactly the state wanted — a subscribed, idle entry —
 * so the warm is a momentary `start()` + `end()` through the registry.
 */
export function useWarmPerUserQuery(): <
  Query extends FunctionReference<"query">,
>(
  query: Query,
  args: FunctionArgs<Query>
) => void {
  const { registry } = useContext(ConvexQueryCacheContext)
  const { isAuthenticated } = useConvexAuth()
  return useCallback(
    (query, args) => {
      if (!registry || !isAuthenticated) return
      const key = cacheQueryKey(query, args)
      // An existing entry (in use or parked) is re-adopted below, which
      // restarts a parked entry's TTL; only a NEW entry needs idle headroom.
      if (
        !registry.queries.has(key) &&
        registry.idle >= registry.maxIdleEntries
      ) {
        return
      }
      const id = crypto.randomUUID()
      registry.start(id, key, query, args)
      registry.end(id)
    },
    [registry, isAuthenticated]
  )
}
