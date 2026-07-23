# 5. The sidebar chat list is a bounded window; full-history access is split onto its own reads

- Status: accepted
- Date: 2026-06-25
- Context: Architecture deepening — Convex function-call cost; branch `darknight/chat-list-window`
- Related: ADR-0004 (per-user subscription seam — the lifecycle half of the same cost audit)

> **Status note (2026-07-23).** The default-on rollback lever was removed after
> its soak. The bounded window is now the sole sidebar path, and the legacy
> full-list query was deleted. Rollback is `git revert`; see
> `docs/measurements/2026-07-23-flag-collapse.md`.

## Context

ADR-0004 closed the _subscription-lifecycle_ channel of the four dominant Convex
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
the write fix halved invalidation _frequency_ but left the O(all-chats)
_per-invalidation_ re-read intact — the dominant term for users with history.

## Decision

Two independent fixes, staged so every full-history consumer gets its own read
**before** the sidebar is bounded.

**1. Write once per turn.** The redundant run-completion `chats.updatedAt` bump was
removed; the chat already re-orders at turn start. `chats.updatedAt` now means
"last activity = turn start time." The turn-start, edit/title, and
`messages.add`/`addBatch`/`selectBranch` bumps are unchanged.

**2. Bound the read; split full-history access onto dedicated reads.**

- **Chat list window** — the sidebar reads a paginated recency window of
  **non-pinned** chats (`chats.getRecentWindowForCurrentUser` over
  `by_user_pinned_updated`, via `usePerUserPaginatedQuery`) plus a small live
  pinned read (`chats.getPinnedForCurrentUser` over the same index prefix).
  Project membership remains in both reads so one source can derive the two
  sidebar grouping modes. A chat write now invalidates only the window, not the
  whole collection. (Browse-all in the history drawer uses a separate
  non-project paginated read,
  `chats.listForCurrentUserPaginated` over `by_user_project_updated`, because
  project chats are hidden while browsing.)
- **History search** is a server query (`chats.searchByTitle` over a `by_title`
  search index, title-only), subscribed only while the search UI is open, behind
  a `SearchProvider` interface so the UI holds `query → results`, never the full
  array.
- **Browse-all** is its own non-project paginated read over
  `by_user_project_updated`, loaded only while the history drawer is open.
- **Per-chat access** is `useChat(chatId)`: the in-window chat synchronously, else
  a targeted `chats.getById` read — which also closed a latent deep-link gap (a
  deep-link to an out-of-window chat used to redirect home).
- **Project pages** get their complete histories from the dedicated
  owner-checked `getProjectChatsForCurrentUser` over `by_project`. The bounded
  sidebar window retains recent project chats so the combined Recents list can
  interleave them. Project-row previews use one additional owner-scoped
  `getSidebarProjectPreviewsForCurrentUser` subscription: it resolves the
  caller's projects, then reads five newest chats plus one `hasMore` sentinel
  per project over `by_project_updated`. A project outside the global recency
  window therefore still has a complete preview.

`updatedAt` was narrowed to required and the recency indexes added so paginated
reads never sort null keys to the tail; safe because the DB is disposable
pre-launch (`PRELAUNCH_DISPOSABLE_DB`, ADR-0002 caveat).

The paginated reads go through a new `usePerUserPaginatedQuery` seam gated on
`isConvexAuthenticated` (ADR-0004 applied to pagination), and the eslint ban on
raw `useQuery` was extended to `usePaginatedQuery`.

The sidebar swap is default-on behind **`ENABLE_PAGINATED_SIDEBAR`** with an
explicit `"false"` rollback value. With the flag disabled, the app reads the
full list exactly as before; the other surfaces' dedicated reads are harmless
because they already cover the full history. A compile-time reference asserts
`chats.searchByTitle` exists wherever the flag can bound the sidebar, so the
list can never be bounded without full-history search present.

### Rejected alternatives (do not relitigate)

- A fixed `.take(N)` instead of `usePaginatedQuery` — caps history at N with no
  load-more.
- A separate `chatActivity` table / second hot field — `chats.updatedAt` is the
  single activity field; "last message at" is derived from the latest message.
- Message-content search — a separate, larger index on `messages`; search is
  title-only.
- One client subscription per project — creates N+1 live subscriptions and
  makes visual rows own data. The chosen aggregate query keeps one client
  subscription while performing bounded, indexed server reads for the owned
  project set.
- The active route still uses the existing targeted `useChat(chatId)` fallback
  to resolve project membership. That keeps an active project expanded even
  when its active chat is older than the five-row preview, without adding a
  subscription per project.

## Consequences

- A chat write re-reads O(window), not O(all-chats). For users with large
  histories the per-invalidation cost — the term ADR-0004 named as dominant for
  `chats` — drops from the whole collection to the window.
- The optimistic overlay is unchanged in shape: it is an id-keyed overlay applied
  to whatever list a surface holds. On the bounded sidebar, ops targeting an
  out-of-window global chat are **no-ops by design**. Project previews apply the
  same overlay to their independent five-row lists, so rename, delete, create,
  and pin operations remain optimistic even when that project chat is outside
  the global window.
- `isLoading` from the chats store now means **"first page ready,"** not "all
  chats loaded." The sidebar is the only consumer of the chat list; per-chat
  consumers use `useChat`, which carries its own fallback `isLoading`.
- Full-history surfaces (search, browse, project, deep-link) each own a read and
  no longer depend on the sidebar list; bounding the sidebar cannot shrink them.
- `ENABLE_PAGINATED_SIDEBAR` is a temporary default-on rollback lever, not
  permanent config — remove it after the soak (follow-up ticket).
- The before/after Convex dashboard numbers are recorded in
  `docs/measurements/chat-list-invalidations.md`.
