# 5. The sidebar chat list is a bounded window; full-history access is split onto its own reads

- Status: accepted
- Date: 2026-06-25
- Context: Architecture deepening — Convex function-call cost; branch `darknight/chat-list-window`
- Related: ADR-0004 (per-user subscription seam — the lifecycle half of the same cost audit)

## Context

ADR-0004 closed the *subscription-lifecycle* channel of the four dominant Convex
queries but explicitly left `chats.getForCurrentUser` — the sidebar list — out of
scope, because its cost is **read-set breadth**, not lifecycle:

- It `.collect()`s the entire `chats.by_user` range and re-sorts in JS, so the
  read-set is the whole collection and any chat change re-reads every chat.
- The chat-turn lifecycle bumped `chats.updatedAt` **twice** per durable turn (run
  start and run completion), so each turn invalidated the full-collection read
  twice.

The same full list also powered **history search**, **browse-all**, the **project
view**, and **per-chat access** (`getChatById`), so it could not simply be
trimmed — bounding it would silently shrink those surfaces to whatever happened to
be in the window.

A Tier-1 measurement (`docs/measurements/chat-list-invalidations.md`) confirmed
the write fix halved invalidation *frequency* but left the O(all-chats)
*per-invalidation* re-read intact — the dominant term for users with history.

## Decision

Two independent fixes, staged so every full-history consumer gets its own read
**before** the sidebar is bounded.

**1. Write once per turn.** The redundant run-completion `chats.updatedAt` bump was
removed; the chat already re-orders at turn start. `chats.updatedAt` now means
"last activity = turn start time." The turn-start, edit/title, and
`messages.add`/`addBatch`/`selectBranch` bumps are unchanged.

**2. Bound the read; split full-history access onto dedicated reads.**

- **Chat list window** — the sidebar reads a paginated recency window of
  **non-pinned, non-project** chats (`chats.getRecentWindowForCurrentUser` over a
  composite `by_user_pinned_project_updated` index, via `usePerUserPaginatedQuery`)
  plus a small live pinned read (`chats.getPinnedForCurrentUser` over
  `by_user_pinned`). Excluding pinned/project at the index level keeps every page
  full of chats the sidebar actually renders, so pinned/project chats never
  consume a window slot. A chat write now invalidates only the window, not the
  whole collection. (Browse-all in the history drawer uses a separate all-chats
  paginated read, `chats.listForCurrentUserPaginated` over `by_user_updated`.)
- **History search** is a server query (`chats.searchByTitle` over a `by_title`
  search index, title-only), subscribed only while the search UI is open, behind
  a `SearchProvider` interface so the UI holds `query → results`, never the full
  array.
- **Browse-all** is its own paginated read over `by_user_updated`, loaded only
  while the history drawer is open.
- **Per-chat access** is `useChat(chatId)`: the in-window chat synchronously, else
  a targeted `chats.getById` read — which also closed a latent deep-link gap (a
  deep-link to an out-of-window chat used to redirect home).
- **Project chats** come from a dedicated owner-checked `getProjectChatsForCurrentUser`
  over `by_project`, so a project shows all its chats.

`updatedAt` was narrowed to required and the `by_user_updated` index added so the
window never sorts null keys to the tail; safe because the DB is disposable
pre-launch (`PRELAUNCH_DISPOSABLE_DB`, ADR-0002 caveat).

The paginated reads go through a new `usePerUserPaginatedQuery` seam gated on
`isConvexAuthenticated` (ADR-0004 applied to pagination), and the eslint ban on
raw `useQuery` was extended to `usePaginatedQuery`.

The sidebar swap ships behind **`ENABLE_PAGINATED_SIDEBAR`** (default off) for
instant rollback. With the flag off, the app reads the full list exactly as
before; the other surfaces' dedicated reads are harmless because they already
cover the full history. A compile-time reference asserts `chats.searchByTitle`
exists wherever the flag can bound the sidebar, so the list can never be bounded
without full-history search present.

### Rejected alternatives (do not relitigate)

- A fixed `.take(N)` instead of `usePaginatedQuery` — caps history at N with no
  load-more.
- A separate `chatActivity` table / second hot field — `chats.updatedAt` is the
  single activity field; "last message at" is derived from the latest message.
- Message-content search — a separate, larger index on `messages`; search is
  title-only.

## Consequences

- A chat write re-reads O(window), not O(all-chats). For users with large
  histories the per-invalidation cost — the term ADR-0004 named as dominant for
  `chats` — drops from the whole collection to the window.
- The optimistic overlay is unchanged in shape: it is an id-keyed overlay applied
  to whatever list a surface holds. On the bounded sidebar, ops targeting an
  out-of-window chat are **no-ops by design** — the surface that shows that chat
  (history drawer / project view) reflects it via its own read.
- `isLoading` from the chats store now means **"first page ready,"** not "all
  chats loaded." The sidebar is the only consumer of the chat list; per-chat
  consumers use `useChat`, which carries its own fallback `isLoading`.
- Full-history surfaces (search, browse, project, deep-link) each own a read and
  no longer depend on the sidebar list; bounding the sidebar cannot shrink them.
- `ENABLE_PAGINATED_SIDEBAR` is a temporary rollout lever, not permanent config —
  remove it after the soak (follow-up ticket).
- The before/after Convex dashboard numbers are recorded in
  `docs/measurements/chat-list-invalidations.md`.
