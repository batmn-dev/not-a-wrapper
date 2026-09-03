# ADR-0031: Warm client query cache for per-user reads

**Status:** Accepted
**Date:** 2026-09-02

## Context

Every chat switch cold-subscribed. `MessagesProvider` opens the split
selected-conversation pair (`getSelectedPath` + `getSelectedRunState`,
ADR-0027) through `usePerUserQuery` when the route commits, and `convex/react`
drops a subscription the moment its last consumer unmounts. Returning to a
thread opened seconds earlier therefore re-subscribed, re-executed the path
collect server-side, and showed a loading state until the result came back.
t3.chat serves the same switch from a client store and paints without one.

No `ConvexQueryCacheProvider` or `preloadQuery` was mounted. convex-helpers
(already a dependency) ships a query cache whose `useQuery` has the same
signature and `"skip"` contract as the core hook: it holds each query's
`watchQuery` open for an idle window after the last consumer leaves, while
values still arrive through `convex/react`'s core `useQueries` on the single
`ConvexReactClient`. ADR-0027 explicitly withheld its same-transition
guarantee from "any cache that decouples the two deliveries"; this cache does
not deliver anything, so that guarantee is unaffected.

## Decision

- Mount the convex-helpers cache at the Convex client boundary
  (`lib/convex/query-cache.tsx`, inside `ConvexClientProvider`) and route the
  per-user seam's `useQuery` through it. Call signatures are unchanged; the
  lint rule that bans raw `useQuery` now covers `convex-helpers/react/cache`
  too. The paginated seam stays on the core hook (the cached variant changes
  pagination-id and page-size semantics, and the sidebar window is mounted
  for the session anyway).
- Bound it twice. Idle TTL 120 s: sidebar back-and-forth happens within a
  couple of minutes of leaving a thread; past that an idle subscription is
  more likely paying re-execution for writes nobody is watching (ADR-0004's
  cost lens) than saving a switch. Idle cap 32 entries, global to every
  cached per-user query: the session-long reads (user document, key status,
  preferences, sidebar window) never go idle, so in practice that is ~16
  parked chats × the pair. At the cap a departing query is dropped instead
  of parked and a warm is skipped, so the hit guarantee below holds for
  chats left within the cap and the TTL.
- Warm ahead of the route. `useWarmPerUserQuery` opens a query as a
  momentary registry `start()` + `end()` — exactly the parked state a
  consumer leaves on unmount — gated on Convex auth readiness like the seam.
  `useWarmSelectedConversation` warms the pair with the provider's exact
  args; the sidebar row calls it after a 100 ms mouse hover (touch and pen
  never hover) and again at click, so the subscription runs alongside the
  route's RSC round-trip instead of after the commit.
- Sign-out is a document navigation (AuthKit redirects to WorkOS), so parked
  subscriptions never outlive an identity. A mid-session auth loss leaves
  the gate closed for consumers; parked entries expire within the TTL.

## Consequences

- A chat revisited within the idle cap and TTL renders its delivered path in
  the route commit itself (harness `SUITE=thread-switch`,
  `nav_to_thread_painted`), and the switch opens zero new Convex
  subscriptions. Unvisited chats subscribe at click instead of at commit.
- Idle subscriptions cost: every write to a parked chat re-executes its path
  query once per parked tab, for up to the TTL. Bounded by the cap and the
  TTL; revisit if the Convex functions dashboard shows the parked window
  dominating `getSelectedPath` executions.
- In-memory only. Reload still cold-loads (persisting the thread list is the
  remaining T3 replication item in TODO.md).
