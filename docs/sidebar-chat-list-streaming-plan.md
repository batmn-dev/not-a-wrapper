# Implementation plan — isolate the sidebar chat-list from streaming writes

- Status: proposed
- Author handoff: senior engineer, single PR, multiple commits
- Related: ADR-0004 (Per-user subscription seam) · CONTEXT.md (Chat turn, Selected path) · ADR-0001/0002 (no production data yet)
- Branch suggestion: `darknight/chat-list-window`

## TL;DR

`chats.getForCurrentUser` (the sidebar list) is one of the most expensive
reactive queries in the app. It has **two independent faults**:

1. **Over-frequent write.** A durable turn bumps `chats.updatedAt` twice — at run
   start (`convex/chatRuntime.ts:1257`) and again at completion
   (`convex/chatRuntime.ts:1460`). The completion bump is redundant: the chat
   already jumped to the top at turn start.
2. **Unbounded read.** The query `.collect()`s the **entire** `by_user` range and
   re-sorts it in JS, so the read-set is the whole collection and any chat change
   re-reads every chat. The same full list also powers history search and
   browse-all, which is why it can't simply be trimmed.

This plan ships **Tier 1** (fix the write — one safe line) first, gates on a
**measurement**, then delivers **Tier 2** (bound the read with pagination + move
search/browse/project/per-chat access onto their own reads) behind a feature
flag. One PR, sequential commits, a verification + quality-review gate between
each risky step.

## Committed design decisions (do not relitigate)

- Sidebar list → `usePaginatedQuery` over a new `by_user_updated [userId, updatedAt]`
  index; **pinned rendered as a separate live section** via the existing
  `by_user_pinned`. Not a fixed `.take(N)`.
- `useChats()` store narrows to the **live window**; per-chat access
  (`getChatById`, deep-links) becomes a targeted `chats.getById(id)` read.
- History **search and browse-all** move off the live full list onto their own
  on-demand reads (server `searchIndex` on `title`; paginated browse). The
  search-provider exposes `query → results`, never "the full array."
- `chats.updatedAt` = **last activity, one bump at turn start**. No second hot
  field; derive any "last message at" display from the latest message.
- **Rejected:** a separate `chatActivity` table.
- Tier 2 payoff (the sidebar swap) ships behind `ENABLE_PAGINATED_SIDEBAR` for
  instant rollback.

## Verified facts (current state)

| Fact | Evidence |
| --- | --- |
| User-message insert does **not** bump `chats.updatedAt` | `convex/chatRuntime.ts:474-513` writes the message's own `updatedAt` only |
| Turn-start bump (keep) | `convex/chatRuntime.ts:1257` `patch(args.chatId, { updatedAt })` |
| Completion bump (remove) | `convex/chatRuntime.ts:1460` `patch(run.chatId, { updatedAt })` |
| `messages.add`/`addBatch` are live mutations (leave alone) | `lib/chat-store/messages/provider.tsx:84-85` |
| History search matches **title only** | `app/components/history/utils.ts:45` |
| Full-list consumers (break under bounding) | sidebar `app-sidebar.tsx:262`; search/browse `history-search-provider.tsx:36` + `drawer-history.tsx:102`; project `project-view.tsx:59`; `getChatById` callers `chat.tsx:42`, `button-new-chat.tsx:19`, `model-selector-header.tsx:26` |
| `chats.getById` already exists (owner-checked) | `convex/chats.ts` |
| `by_project` index already exists | `convex/schema.ts:86` |
| No production data; schema narrowing pushes cleanly | ADR-0002; `PRELAUNCH_DISPOSABLE_DB=true` |

## Commit overview

| # | Tier | Commit | Risk | Gate before next |
| --- | --- | --- | --- | --- |
| 1 | 1 | Remove the run-complete `chats.updatedAt` bump | low | verify 2→1 bump/turn |
| 2 | gate | Record the Tier-1 measurement; decide on Tier 2 | none | **STOP** — measurement |
| 3 | 2 | Server title search + `SearchProvider` interface | med | search finds out-of-window chats |
| 4 | 2 | Repoint history drawer (search + browse) onto its own reads | med | full history reachable off `useChats()` |
| 5 | 2 | `by_user_updated` index + `updatedAt` required + backfill | med | index has no null keys |
| 6 | 2 | `useChat(chatId)` hook; migrate `getChatById` call sites | med | deep-link to old chat resolves |
| 7 | 2 | Dedicated project-chats query; migrate project view | low–med | old project chats visible |
| 8 | 2 | Paginate sidebar + pinned split (behind flag) | high | flag-off == today; flag-on verified |
| 9 | 2 | Flip flag on staging→prod; record post-fix measurement | med | dashboard confirms drop |

> Ordering is load-bearing. Commits 3–7 are **prerequisites** that each remove one
> full-list dependency; commit 8 is the only one that bounds the list, and it must
> not land before 3–7 or a surface silently shrinks to the window.

---

## Tier 1 — fix the write (safe, ships immediately)

### Commit 1 — Remove the redundant completion bump

**Goal.** One `chats.updatedAt` bump per durable turn instead of two. The chat
still re-orders to the top at turn start (`1257`); `updatedAt` becomes "turn
start time," which is correct for ordering (the client also bumps optimistically
via `bumpChat`).

**Files / change.**
- `convex/chatRuntime.ts:1460` — delete the single line
  `await ctx.db.patch(run.chatId, { updatedAt: now })` in the
  `markGenerationRunCompleted` path. **Keep `1257`.** Do **not** touch
  `messages.ts` `add`/`addBatch`/`selectBranch` bumps (different paths) or the
  edit bump at `chatRuntime.ts:775`.

**Verification.**
- `bun run typecheck && bun run lint && bun run test`
- Lean test: in `convex/chatRuntime.test.ts`, capture the chat's `updatedAt`
  before `markGenerationRunCompleted*`, assert it is **unchanged** after (and that
  the run/message patches still fire). Add
  `expect(patches.filter(p => p.id === run.chatId)).toEqual([])` on the success
  path.
- Manual: send a message; confirm the chat jumps to the top of the sidebar **at
  send**, stays put during streaming, and does not re-order at completion.
- Convex dashboard / function logs: confirm `chats.getForCurrentUser`
  invalidations per turn drop from ~2 → ~1.

**Quality review (before commit 2).**
- No consumer reads `updatedAt` as completion time (sidebar relative timestamps,
  if any, now read send time — acceptable, documented).
- Regenerate / edit / branch-select still re-order as expected (they retain their
  own bumps).

**Risk:** low. **Rollback:** re-add the one line.

---

### Commit 2 — Measurement gate (Tier 1 → Tier 2 boundary)

**Goal.** Decide, on evidence, whether Tier 2 is warranted — the same
measure-before-building discipline as ADR-0004.

**Files / change.** Docs-only:
`docs/measurements/chat-list-invalidations.md` recording, after commit 1 is
deployed:
- date, sample (messages sent, duration);
- `chats.getForCurrentUser` call count split into **initial-subscribe vs
  invalidation re-runs**;
- per-turn invalidation count (expect ~1);
- guest-caller sanity on `userKeys.getProviderStatus` (should be zero post
  ADR-0004);
- a go / no-go note for Tier 2.

**Gate (STOP).** Proceed to Tier 2 **only if** the residual cost is material —
i.e., the O(all-chats) re-read per invalidation, or remaining per-turn
invalidations on users with large histories, still dominate. If Tier 1 brought
`chats` acceptably low, **defer Tier 2** and stop the PR here (commits 1–2 are a
complete, shippable unit).

**Risk:** none.

---

## Tier 2 — bound the read (staged; each step removes one full-list dependency)

> Build order is the safety mechanism: every surface that needs the full history
> gets its own read (commits 3–7) **before** the sidebar is bounded (commit 8).

### Commit 3 — Server title search + `SearchProvider` interface

**Goal.** Make full-history search a server query that never ships the whole
table, behind an interface so the UI stops holding "the full array."

**Files / change.**
- `convex/schema.ts` — add a `searchIndex("by_title", { searchField: "title", filterFields: ["userId"] })` to the `chats` table (search is title-only, verified).
- `convex/chats.ts` — `searchByTitle` (`maybeAuthQuery`): `withSearchIndex` filtered to `ctx.user._id`, returns matches; empty/short query returns `[]`.
- `app/components/history/search-provider-interface.ts` (new) — a `SearchProvider`
  shape: `{ query, setQuery, results, isLoading }`. Implementation subscribes to
  `searchByTitle` **only while the search UI is open** (`usePerUserQuery(..., open ? { term } : "skip")`), debounced.

**Verification.**
- `bun run typecheck && bun run lint && bun run test`
- Manual: search returns chats by title via the server; the subscription is
  **absent** when the search UI is closed (Convex dashboard / `"skip"`).
- **Gate check:** search finds a deliberately **old** chat (one that will fall
  outside the future recent window). This is the precondition for commit 8.

**Quality review (before commit 4).**
- Subscription lifecycle: opens on search-open, drops on close (lean test mocking
  the open/closed arg → asserts `"skip"` when closed).
- Search scope confirmed title-only; if product later wants message-content
  search, that is a separate index on `messages` — out of scope, noted.

**Risk:** medium. **Rollback:** remove query/index/interface; nothing consumes it yet.

---

### Commit 4 — Repoint the history drawer (search **and** browse-all) onto its own reads

**Goal.** Remove the history surface's dependency on `useChats().chats`. The
drawer has two modes and **both** read the full list today.

**Files / change.**
- `app/components/history/history-search-provider.tsx:36` — stop passing
  `useChats().chats` as the corpus.
- Search mode → `SearchProvider.results` (commit 3).
- Browse mode (empty query, date-grouped) → its own **paginated browse read**
  (`usePaginatedQuery` over `by_user_updated`, loaded only while the drawer is
  open, load-more on scroll). `buildChatHistoryView`
  (`app/components/history/utils.ts`) keeps grouping; only its input source
  changes.
- `drawer-history.tsx` / `desktop-search-modal.tsx` consume from the provider.
- Optimistic title-edit / delete from the drawer apply to the drawer's own list
  (id-keyed overlay), not the sidebar's.

**Verification.**
- Manual: open history → browse shows full history grouped by date (scroll loads
  more); search finds old chats; edit-title / delete in the drawer reflect
  immediately.
- `bun run test` — update `app/components/history/utils.test.ts` only if the
  grouping input shape changed (it should not; keep tests lean).

**Quality review (before commit 5).**
- The history drawer no longer references `useChats().chats`. Grep to confirm.
- Browse + search both reach chats that will be outside the recent window.

**Risk:** medium. **Rollback:** repoint the drawer back to `useChats().chats`.

---

### Commit 5 — `by_user_updated` index, `updatedAt` required, backfill

**Goal.** An index that orders the sidebar by recency with no null keys.

**Files / change.**
- `convex/schema.ts` — add `.index("by_user_updated", ["userId", "updatedAt"])`;
  change `updatedAt: v.optional(v.number())` → `v.number()` (required) so the
  index never sorts null keys to the tail (which would hide chats).
- Audit every chat write sets `updatedAt`: `create` (sets it), `updateTitle`,
  `updateModel`, `togglePin`, `makePublic`, `chatRuntime:1257`. All do.
- `scripts/backfill-chat-updated-at.mjs` (or a Convex migration) —
  `updatedAt = _creationTime` for any legacy row missing it. Run before commit 8
  uses the index.

**Verification.**
- `bunx convex dev` schema push succeeds (narrowing is clean — no prod data, ADR-0002).
- Test: create a chat → `updatedAt` set; the `by_user_updated` query returns no
  null-keyed rows.

**Quality review (before commit 6).**
- ADR-0002 caveat noted: the expand/migrate/contract guard catches field
  **removals** only, not this narrowing — safe now because the DB is disposable
  (`PRELAUNCH_DISPOSABLE_DB=true`). If that changes, this step needs a backfill +
  verifier, not a bare narrowing.

**Risk:** medium. **Rollback:** revert `updatedAt` to optional, drop the index.

---

### Commit 6 — `useChat(chatId)` hook; migrate `getChatById` call sites

**Goal.** Per-chat access works when the chat is outside the sidebar window
(fixes a latent deep-link gap too).

**Files / change.**
- `lib/chat-store/chats/use-chat.ts` (new) — `useChat(chatId)`: returns the
  in-window chat synchronously from `useChats().getChatById` if present, else
  falls back to `usePerUserQuery(api.chats.getById, { chatId })`. Exposes
  `{ chat, isLoading }`.
- Migrate `chat.tsx:42`, `button-new-chat.tsx:19`, `model-selector-header.tsx:26`
  from `getChatById(chatId)` to `useChat(chatId)`; handle the brief `isLoading`
  for out-of-window chats.

**Verification.**
- Manual: deep-link `/c/<oldChatId>` (a chat not in the recent window) → header,
  new-chat button, and model selector all resolve it; an in-window chat resolves
  with no loading flash.
- Lean test: `useChat` returns the in-memory chat synchronously, and falls back to
  `api.chats.getById` for an id not in the list (mock the query).

**Quality review (before commit 7).**
- All three call sites tolerate `chat === undefined` during the fallback load.
- No remaining synchronous `getChatById` assumptions in those files.

**Risk:** medium. **Rollback:** revert call sites to `getChatById`.

---

### Commit 7 — Dedicated project-chats query; migrate project view

**Goal.** A project shows **all** its chats, not just those in the recent window.

**Files / change.**
- `convex/chats.ts` — `getProjectChatsForCurrentUser(projectId)`
  (owner-checked via `ownedProjectQuery` or equivalent) over the existing
  `by_project` index.
- `app/p/[projectId]/project-view.tsx:59` — replace the
  `useChats().chats.filter(c => c.project_id === projectId)` with the dedicated
  query.

**Verification.**
- Manual: a project with chats older than the recent window shows every one.
- `bun run typecheck && lint && test`.

**Quality review (before commit 8).**
- Project view no longer reads `useChats().chats`. Grep to confirm.

**Risk:** low–medium. **Rollback:** revert to the client-side filter.

---

### Commit 8 — Paginate the sidebar + pinned split (behind `ENABLE_PAGINATED_SIDEBAR`)

**Goal.** The payoff: bound the live sidebar read. **Only safe because commits
3–7 moved every full-history consumer onto its own read.**

**Files / change.**
- `convex/chats.ts` — paginated recent read over `by_user_updated`
  (`paginationOpts`, `order("desc")`), excluding pinned; a separate
  `getPinnedForCurrentUser` over `by_user_pinned` (small, live).
- `lib/chat-store/chats/provider.tsx`:
  - Recent window via `usePaginatedQuery`; pinned via the separate read.
  - `nonPinnedChats = window.filter(c => !c.pinned && !c.project_id)`; pinned
    comes only from the pinned read (no duplication).
  - **Optimistic-ops overlay:** keep `optimisticOps` as an id-keyed overlay
    applied to whatever list a surface holds. In the sidebar it applies to the
    window (add → prepend, in-window update/delete → applied). Ops targeting an
    **out-of-window** chat are no-ops in the sidebar — that chat is shown in the
    history drawer / project view, which apply their own overlay or re-read.
    Document this: "optimistic updates to chats outside the sidebar window are
    reflected by the surface that shows them, not the sidebar."
  - `isLoading` now means **"first page ready"** (not "all chats loaded"). Update
    the doc comment and any consumer that gated on full load.
- `app-sidebar.tsx` — render pinned section + paginated recent with load-more on
  scroll.
- Gate the new path behind `ENABLE_PAGINATED_SIDEBAR` (default **false**). Flag
  off ⇒ today's full-list behavior (now harmless: all other surfaces already
  migrated). Add a startup assertion that `api.chats.searchByTitle` exists when
  the flag is on, so the sidebar can never be bounded without search-swap present.

**Verification.**
- Flag **off:** app behaves exactly as today. `bun run typecheck && lint && test`.
- Flag **on** (staging): sidebar shows pinned + recent window; scroll loads more;
  send a message → chat re-orders correctly; optimistic create / delete / pin work
  for in-window chats; search, browse-all, project view, and deep-links still
  cover full history.
- Lean tests for the risky logic only: pinned/non-pinned partition has no
  intersection; optimistic add to the window; `isLoading` true→false on first
  page.

**Quality review (before commit 9).**
- Pagination composes with the optimistic overlay without dropping in-window ops.
- No surface reads `useChats().chats` expecting the full list (grep: sidebar,
  history, project, getById callers all migrated).

**Risk:** high. **Rollback:** flip `ENABLE_PAGINATED_SIDEBAR` off (instant); then
revert the commit if needed.

---

### Commit 9 — Roll out + record the post-fix measurement

**Goal.** Turn the bounded sidebar on safely and prove the win.

**Files / change.**
- Flip `ENABLE_PAGINATED_SIDEBAR` true on staging, soak, then production.
- Append to `docs/measurements/chat-list-invalidations.md`: post-Tier-2
  `chats.*` call counts (expect O(window) per invalidation; writes to old chats no
  longer invalidate the sidebar).
- Record the architecture as **ADR-0005** (bounded chat-list window + search/
  browse/project/per-chat split), parallel to ADR-0004; add the **Chat list
  window** vs **history search** distinction to `CONTEXT.md`.
- Follow-up ticket: remove the flag once stable.

**Verification.** Dashboard shows the drop; no regression reports on
search/browse/project/deep-link.

**Risk:** medium (rollout). **Rollback:** flag off.

---

## PR-level acceptance criteria

- `bun run typecheck`, `bun run lint`, `bun run test` green at **every** commit.
- Each commit leaves the app working and is independently revertible.
- With `ENABLE_PAGINATED_SIDEBAR` **off**, behavior is identical to today.
- With it **on**: sidebar reads a bounded window; search, browse-all, project
  view, and deep-links all still reach full history; sending a message re-orders
  the sidebar once and does not re-read the whole collection.
- `docs/measurements/chat-list-invalidations.md` shows the before/after drop.
- Tests added only for risky logic (write-once bump, pinned/non-pinned partition,
  optimistic-in-window, `useChat` fallback, search subscription lifecycle) —
  per the lean-tests preference.

## Open risks / notes

- **Optimistic ops × pagination** is the subtlest area (commit 8). The overlay
  model keeps it correct, but test the in-window add/delete and the out-of-window
  no-op explicitly.
- **`isLoading` semantics change** (commit 8) from "all loaded" to "first page
  ready." Audit every `isLoading` consumer in that commit.
- **Schema narrowing** (`updatedAt` optional→required, commit 5) is safe only
  while the DB is disposable; revisit if production data lands before this ships.
- **Search content scope:** title-only today. Message-content search is a
  separate, larger change (index on `messages`) and is explicitly out of scope.
- **Flag hygiene:** `ENABLE_PAGINATED_SIDEBAR` is a temporary rollout lever, not a
  permanent config; remove it after the soak.
