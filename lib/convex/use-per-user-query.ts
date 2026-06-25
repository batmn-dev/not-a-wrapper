/**
 * Per-user subscription seam — the client counterpart to the Authenticated
 * handler (ADR-0003), recorded in ADR-0004.
 *
 * Every per-user Convex live read goes through `usePerUserQuery`, which owns the
 * one correct subscribe gate: `isConvexAuthenticated` (the Convex JWT is synced),
 * NOT WorkOS session presence (`!!user` / `!!userId`). WorkOS presence flips true
 * before the Convex JWT is synced, so gating on it subscribes during the
 * auth-sync window — the query executes server-side, `getCurrentUser` resolves no
 * identity, returns an empty/wrong result, then re-executes once the token lands.
 * Gating on `isConvexAuthenticated` is what makes the control query
 * (`users.getCurrent`) cheap; this hook makes that gate structural so no call
 * site re-derives it with a different predicate (and none can forget it, the way
 * `userKeys.getProviderStatus` did).
 *
 * Public / share-link reads (no user concept, e.g. `chats.getPublicById`) go
 * through `usePublicQuery`, the explicit passthrough — the client mirror of the
 * server's public `query` sitting beside `maybeAuthQuery`. A `no-restricted-syntax`
 * lint rule bans importing `useQuery` from `convex/react` outside this module, so
 * every call site declares per-user vs public. This module is the one exempt
 * place that may import it.
 */

import {
  useConvexAuth,
  usePaginatedQuery,
  useQuery,
  type OptionalRestArgsOrSkip,
  type PaginatedQueryArgs,
  type PaginatedQueryReference,
  type UsePaginatedQueryReturnType,
} from "convex/react"
import type { FunctionReference, FunctionReturnType } from "convex/server"

type QueryRef = FunctionReference<"query">

export type PerUserQueryResult<Query extends QueryRef> = {
  /** The query result, or `undefined` while loading or gated out. */
  data: FunctionReturnType<Query> | undefined
  /** True once the Convex JWT is synced — the subscribe gate. */
  isAuthReady: boolean
  /** True while auth is resolving, or while the subscribed query is in flight. */
  isLoading: boolean
}

/**
 * Subscribe to a per-user Convex query, gated on Convex auth readiness. Returns
 * `"skip"` to Convex until the caller is authenticated, so signed-out and
 * mid-auth-sync callers never open a subscription. Callers may still pass
 * `"skip"` themselves (e.g. no chat selected yet); the gate is the conjunction.
 */
export function usePerUserQuery<Query extends QueryRef>(
  query: Query,
  ...args: OptionalRestArgsOrSkip<Query>
): PerUserQueryResult<Query> {
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth()
  const callerSkipped = args[0] === "skip"
  const gatedArgs = (
    isAuthenticated && !callerSkipped ? args : ["skip"]
  ) as OptionalRestArgsOrSkip<Query>
  const data = useQuery(query, ...gatedArgs)
  return {
    data,
    isAuthReady: isAuthenticated,
    isLoading:
      isAuthLoading ||
      (isAuthenticated && !callerSkipped && data === undefined),
  }
}

/**
 * Subscribe to a per-user *paginated* Convex query, gated on Convex auth
 * readiness — the `usePaginatedQuery` counterpart to `usePerUserQuery`. Returns
 * `"skip"` to Convex (no subscription, no pages) until the caller is
 * authenticated, so signed-out and mid-auth-sync callers never open a paginated
 * subscription. Callers may still pass `"skip"` themselves (e.g. the drawer is
 * closed); the gate is the conjunction. A `no-restricted-syntax` lint rule bans
 * importing `usePaginatedQuery` from `convex/react` outside this module, just as
 * it does `useQuery`. See ADR-0004.
 */
export function usePerUserPaginatedQuery<
  Query extends PaginatedQueryReference,
>(
  query: Query,
  args: PaginatedQueryArgs<Query> | "skip",
  options: { initialNumItems: number }
): UsePaginatedQueryReturnType<Query> {
  const { isAuthenticated } = useConvexAuth()
  const gatedArgs =
    isAuthenticated && args !== "skip" ? args : ("skip" as const)
  return usePaginatedQuery(query, gatedArgs, options)
}

/**
 * Subscribe to a genuinely-public Convex query (share links, public chats) with
 * no auth gate. The explicit escape hatch from the per-user taxonomy — naming it
 * is the point, so public intent is declared rather than implied by a bare
 * `useQuery`.
 */
export function usePublicQuery<Query extends QueryRef>(
  query: Query,
  ...args: OptionalRestArgsOrSkip<Query>
): FunctionReturnType<Query> | undefined {
  return useQuery(query, ...args)
}
